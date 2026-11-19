"""HTTP API.

Identity: every chat request must carry `Authorization: Bearer <session token>` issued by
/api/auth/demo-login (a clearly-labelled SIMULATED login). The employee identity is resolved
from the verified token on the server; the chat body has no identity field at all.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.config import DOCUMENTS_DIR, EVALUATION_DIR, get_settings
from app.observability import fingerprint, request_id_var
from app.retrieval.chunking import load_corpus
from app.security.identity import DEMO_IDENTITIES, InvalidToken, Principal, issue_session_token, principal_from_session

log = logging.getLogger("api")
router = APIRouter(prefix="/api")


# ------------------------------------------------------------------ helpers
class RateLimiter:
    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str) -> bool:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= self.per_minute:
            return False
        q.append(now)
        return True


_limiter = RateLimiter(get_settings().chat_rate_limit_per_minute)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")


def current_principal(authorization: str | None = Header(default=None)) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in with a simulated employee session first.")
    try:
        return principal_from_session(authorization.split(" ", 1)[1].strip(), get_settings().session_secret.get_secret_value())
    except InvalidToken:
        raise HTTPException(status_code=401, detail="Session invalid or expired. Please choose a session again.")


# ------------------------------------------------------------------ models
class LoginRequest(BaseModel):
    subject_id: str = Field(max_length=16)


class HistoryTurn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(max_length=8000)
    conversation_id: str | None = Field(default=None, max_length=64)
    history: list[HistoryTurn] = Field(default_factory=list, max_length=12)


# ------------------------------------------------------------------ endpoints
@router.get("/health")
async def health(request: Request):
    svc = request.app.state.services
    await svc.ensure_index()
    return {
        "status": "ok" if svc.ready else "starting",
        "components": {
            "vector_store": {"ok": svc.chunks_loaded > 0, "chunks": svc.chunks_loaded, "backend": "qdrant-cloud" if get_settings().qdrant_url else "qdrant-local", "error": svc.vector_store_error},
            "models": {"backend": svc.model_backend, "embedding": get_settings().bge_m3_model, "reranker": get_settings().bge_reranker_model, "warm": svc.models_warm},
            "mcp": {"connected": svc.mcp.connected, "tools": svc.mcp_tools},
            "generation": {"configured": svc.llm is not None, "model": get_settings().generation_model},
        },
        "fictional_data": True,
    }


@router.get("/demo-identities")
async def demo_identities():
    return {"simulated": True, "identities": DEMO_IDENTITIES}


@router.post("/auth/demo-login")
async def demo_login(body: LoginRequest):
    s = get_settings()
    try:
        token, claims = issue_session_token(body.subject_id, s.session_secret.get_secret_value(), s.session_ttl_seconds)
    except InvalidToken:
        raise HTTPException(status_code=404, detail="Unknown simulated identity.")
    ident = next(i for i in DEMO_IDENTITIES if i["subject_id"] == body.subject_id)
    return {"token": token, "expires_at": claims["exp"], "identity": ident, "simulated": True}


@router.get("/auth/me")
async def me(principal: Principal = Depends(current_principal)):
    ident = next((i for i in DEMO_IDENTITIES if i["subject_id"] == principal.subject_id), None)
    return {"identity": ident, "simulated": True}


@router.get("/documents")
async def documents():
    docs = load_corpus(DOCUMENTS_DIR)
    return {"documents": [{"document_id": d.document_id, "title": d.title, "owner": d.owner, "version": d.version,
                           "effective_date": d.effective_date, "status": d.status, "source_file": d.source_file,
                           "sections": [{"number": n, "title": t} for n, t, _ in d.sections]} for d in docs]}


@router.get("/documents/{document_id}")
async def document(document_id: str):
    for d in load_corpus(DOCUMENTS_DIR):
        if d.document_id == document_id:
            return {"document_id": d.document_id, "title": d.title, "owner": d.owner, "version": d.version,
                    "effective_date": d.effective_date, "status": d.status,
                    "sections": [{"number": n, "title": t, "body": b} for n, t, b in d.sections]}
    raise HTTPException(status_code=404, detail="Document not found")


@router.get("/evaluation")
async def evaluation():
    path = EVALUATION_DIR / "retrieval_metrics.json"
    if not path.exists():
        return JSONResponse({"available": False})
    return {"available": True, **json.loads(path.read_text())}


@router.post("/chat")
async def chat(body: ChatRequest, request: Request, principal: Principal = Depends(current_principal)):
    svc = request.app.state.services
    if not _limiter.check(f"{principal.subject_id}:{client_ip(request)}"):
        raise HTTPException(status_code=429, detail="Too many requests — please wait a moment.")
    if not await svc.ensure_index():
        raise HTTPException(status_code=503, detail="The assistant is still starting up. Try again in a few seconds.")

    request_id = uuid.uuid4().hex[:12]
    request_id_var.set(request_id)
    state = {
        "request_id": request_id,
        "conversation_id": body.conversation_id or request_id,
        "authenticated_subject_id": principal.subject_id,  # from the verified session token only
        "user_role": principal.role,
        "user_display_name": principal.display_name,
        "user_message": body.message,
        "history": [t.model_dump() for t in body.history],
        "notices": [],
        "tool_calls": [],
        "timings": {},
    }
    log.info("chat_request", extra={"subject": principal.subject_id, "role": principal.role, **fingerprint(body.message)})

    async def events():
        t0 = time.perf_counter()
        yield {"event": "meta", "data": json.dumps({"request_id": request_id})}
        final = None
        try:
            async for mode, chunk in svc.graph.astream(state, stream_mode=["custom", "values"]):
                if await request.is_disconnected():
                    return
                if mode == "custom":
                    yield {"event": chunk.get("type", "stage"), "data": json.dumps(chunk, default=str)}
                elif mode == "values" and chunk.get("final"):
                    final = chunk["final"]
        except Exception as exc:
            log.exception("graph_failed", extra={"error": type(exc).__name__})
            yield {"event": "error", "data": json.dumps({"message": "Something went wrong while answering. Please try again.", "request_id": request_id})}
            return
        if final is not None:
            final["timings"]["total_ms"] = round((time.perf_counter() - t0) * 1000, 1)
            log.info("chat_response", extra={"status": final["status"], "route": final["route"], "intent": final["intent"],
                                             "citations": len(final["citations"]), "tools": [t["tool"] for t in final["tool_calls"]],
                                             "flags": [f["category"] for f in final["security"]["flags"]], "total_ms": final["timings"]["total_ms"]})
            yield {"event": "final", "data": json.dumps(final, default=str)}
        yield {"event": "done", "data": "{}"}

    return EventSourceResponse(events(), ping=10, headers={"X-Request-ID": request_id, "Cache-Control": "no-store"})


async def run_once(graph, state: dict) -> dict:
    """Non-streaming helper (evaluation scripts / tests)."""
    out = await graph.ainvoke(state)
    return out["final"]


__all__ = ["router", "run_once", "asyncio"]
