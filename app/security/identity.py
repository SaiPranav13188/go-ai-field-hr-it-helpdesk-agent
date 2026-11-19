"""Signed identity tokens (HMAC-SHA256, compact `payload.signature` format).

Two independent token types with different secrets and audiences:

* Session token  (aud="helpdesk-api", SESSION_SECRET, hours)
    Issued by the *simulated* demo login and sent by the browser as a Bearer token. The API
    resolves the employee identity ONLY from this verified token — never from chat text.

* MCP identity assertion  (aud="hr-helpdesk-mcp", MCP_IDENTITY_SECRET, 60 s, single-use jti)
    Minted by the backend per tool call from the verified session. The MCP server verifies it
    and derives the employee ID from it; the tool has no "employee_id" parameter to tamper with.

This is a demo identity boundary, not production authentication: a real deployment would
replace the simulated login with SSO/OIDC and keep the same server-side resolution.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass

SESSION_AUDIENCE = "helpdesk-api"
MCP_AUDIENCE = "hr-helpdesk-mcp"


class InvalidToken(Exception):
    pass


@dataclass(frozen=True)
class Principal:
    subject_id: str
    role: str  # "employee" | "hr_admin"
    display_name: str = ""
    jti: str = ""


# Simulated identity directory for the demo login selector (synthetic people only).
DEMO_IDENTITIES: list[dict] = [
    {"subject_id": "E101", "display_name": "Aarav Mehta", "department": "Engineering", "role": "employee"},
    {"subject_id": "E102", "display_name": "Priya Sharma", "department": "Human Resources", "role": "employee"},
    {"subject_id": "E103", "display_name": "Kabir Rao", "department": "IT Support", "role": "employee"},
    {"subject_id": "E104", "display_name": "Ananya Iyer", "department": "Finance", "role": "employee"},
    {"subject_id": "E105", "display_name": "Ishaan Patel", "department": "Product", "role": "employee"},
    {"subject_id": "HR900", "display_name": "HR Administrator", "department": "HR Operations (role demo)", "role": "hr_admin"},
]
_DIRECTORY = {d["subject_id"]: d for d in DEMO_IDENTITIES}


def lookup_demo_identity(subject_id: str) -> dict | None:
    return _DIRECTORY.get(subject_id)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def sign(claims: dict, secret: str) -> str:
    body = _b64(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode())
    sig = _b64(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def verify(token: str, secret: str, audience: str, now: float | None = None) -> dict:
    try:
        body, sig = token.split(".")
    except (ValueError, AttributeError):
        raise InvalidToken("malformed")
    expected = _b64(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        raise InvalidToken("bad signature")
    try:
        claims = json.loads(_unb64(body))
    except Exception:
        raise InvalidToken("malformed payload")
    now = now or time.time()
    if claims.get("aud") != audience:
        raise InvalidToken("wrong audience")
    if not isinstance(claims.get("exp"), (int, float)) or claims["exp"] < now:
        raise InvalidToken("expired")
    if claims.get("iat", 0) > now + 30:
        raise InvalidToken("issued in the future")
    if claims.get("role") not in {"employee", "hr_admin"} or not isinstance(claims.get("sub"), str):
        raise InvalidToken("bad claims")
    return claims


def issue_session_token(subject_id: str, secret: str, ttl: int) -> tuple[str, dict]:
    ident = lookup_demo_identity(subject_id)
    if ident is None:
        raise InvalidToken("unknown demo identity")
    now = int(time.time())
    claims = {"sub": subject_id, "role": ident["role"], "name": ident["display_name"], "aud": SESSION_AUDIENCE,
              "iat": now, "exp": now + ttl, "jti": secrets.token_hex(8), "sim": True}
    return sign(claims, secret), claims


def principal_from_session(token: str, secret: str) -> Principal:
    c = verify(token, secret, SESSION_AUDIENCE)
    return Principal(subject_id=c["sub"], role=c["role"], display_name=c.get("name", ""), jti=c["jti"])


def issue_mcp_assertion(principal: Principal, secret: str, request_id: str, ttl: int = 60) -> str:
    now = int(time.time())
    return sign({"sub": principal.subject_id, "role": principal.role, "aud": MCP_AUDIENCE, "iat": now,
                 "exp": now + ttl, "jti": secrets.token_hex(12), "rid": request_id}, secret)
