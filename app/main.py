"""FastAPI application entry point.

    uv run uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.agent.graph import build_graph
from app.agent.llm import GeminiLLM, LLMUnavailable
from app.agent.mcp_client import McpGateway
from app.agent.nodes import AgentDeps
from app.api.routes import router
from app.config import Settings, get_settings
from app.observability import setup_logging
from app.retrieval.bge_embeddings import build_embedder, resolve_backend
from app.retrieval.hybrid_search import HybridRetriever
from app.retrieval.reranker import build_reranker
from app.retrieval.vector_store import async_client

log = logging.getLogger("app")


@dataclass
class Services:
    settings: Settings
    retriever: HybridRetriever
    mcp: McpGateway
    llm: GeminiLLM | None
    graph: object
    model_backend: str
    chunks_loaded: int = 0
    models_warm: bool = False
    mcp_tools: list[str] = field(default_factory=list)

    @property
    def ready(self) -> bool:
        return self.chunks_loaded > 0


def build_services(settings: Settings, mcp_server=None) -> Services:
    backend = resolve_backend(settings)
    retriever = HybridRetriever(settings, async_client(settings), build_embedder(settings, backend), build_reranker(settings, backend))
    try:
        llm = GeminiLLM(settings)
    except LLMUnavailable:
        llm = None
        log.warning("generation_model_not_configured")
    mcp = McpGateway(settings, server=mcp_server)
    graph = build_graph(AgentDeps(settings=settings, retriever=retriever, llm=llm, mcp=mcp))
    return Services(settings=settings, retriever=retriever, mcp=mcp, llm=llm, graph=graph, model_backend=backend)


async def _warm_models(svc: Services) -> None:
    try:
        for m in (svc.retriever.embedder, svc.retriever.reranker):
            if hasattr(m, "warmup"):
                await asyncio.to_thread(m.warmup)
        svc.models_warm = True
        log.info("models_warm", extra={"backend": svc.model_backend})
    except Exception as exc:
        log.warning("model_warmup_failed", extra={"error": type(exc).__name__})


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(settings.log_level)
    svc = build_services(settings)
    app.state.services = svc
    try:
        svc.chunks_loaded = await svc.retriever.load()
    except Exception as exc:
        log.error("vector_store_unavailable", extra={"error": type(exc).__name__})
    await svc.mcp.start()
    try:
        svc.mcp_tools = await svc.mcp.list_tools()
    except Exception:
        svc.mcp_tools = []
    warm = asyncio.create_task(_warm_models(svc))
    log.info("startup_complete", extra={"chunks": svc.chunks_loaded, "mcp_tools": svc.mcp_tools, "backend": svc.model_backend,
                                        "llm": settings.generation_model if svc.llm else None})
    yield
    warm.cancel()
    await svc.mcp.stop()
    await svc.retriever.client.close()


app = FastAPI(title="Go AI Field — HR & IT Helpdesk Agent", version="1.0.0", lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app" if get_settings().app_env != "production" else None,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    return response


app.include_router(router)


@app.get("/")
async def root():
    return {"service": "go-ai-field-hr-it-helpdesk-agent", "docs": "/api/docs", "health": "/api/health"}
