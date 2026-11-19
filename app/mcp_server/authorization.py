"""Authorization for MCP tools — enforced in server code, never delegated to the LLM."""

from __future__ import annotations

import re
import threading
import time

from app.security.identity import MCP_AUDIENCE, InvalidToken, Principal, verify

EMPLOYEE_ID_RE = re.compile(r"^E\d{3,6}$")
VALID_LEAVE_TYPES = ("earned", "casual", "sick")


class AuthorizationError(Exception):
    """Raised for any authn/authz failure. The message is safe to return to the caller."""


class ReplayGuard:
    """Single-use assertions: a jti may be presented once within its lifetime."""

    def __init__(self):
        self._seen: dict[str, float] = {}
        self._lock = threading.Lock()

    def check_and_store(self, jti: str, exp: float) -> None:
        now = time.time()
        with self._lock:
            for k in [k for k, e in self._seen.items() if e < now]:
                del self._seen[k]
            if jti in self._seen:
                raise AuthorizationError("identity assertion already used")
            self._seen[jti] = exp


class Authorizer:
    def __init__(self, secret: str):
        self._secret = secret
        self._replay = ReplayGuard()

    def authenticate(self, assertion: str) -> tuple[Principal, str]:
        """Returns (principal, request_id)."""
        if not isinstance(assertion, str) or len(assertion) > 2048:
            raise AuthorizationError("invalid identity assertion")
        try:
            claims = verify(assertion, self._secret, MCP_AUDIENCE)
        except InvalidToken:
            raise AuthorizationError("invalid identity assertion")
        self._replay.check_and_store(claims["jti"], claims["exp"])
        return Principal(subject_id=claims["sub"], role=claims["role"], jti=claims["jti"]), str(claims.get("rid", ""))

    @staticmethod
    def require_hr(principal: Principal) -> None:
        if principal.role != "hr_admin":
            raise AuthorizationError("this tool requires the HR administrator role")


def validate_leave_types(leave_types: list[str] | None) -> list[str]:
    if not leave_types:
        return list(VALID_LEAVE_TYPES)
    if not isinstance(leave_types, list) or len(leave_types) > 3:
        raise ValueError("leave_types must be a list of up to three values")
    out = []
    for t in leave_types:
        if t not in VALID_LEAVE_TYPES:
            raise ValueError(f"unsupported leave type: {t!r}")
        if t not in out:
            out.append(t)
    return out


def validate_employee_id(value: str) -> str:
    if not isinstance(value, str) or not EMPLOYEE_ID_RE.match(value.strip().upper()):
        raise ValueError("target_employee_id must look like E123")
    return value.strip().upper()
