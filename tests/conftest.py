"""Shared fixtures. Tests are offline and fast: a deterministic hash embedder and a
token-overlap reranker stand in for the BAAI models, a scripted fake LLM stands in for Gemini,
and the MCP server runs in-process over the real MCP protocol with an in-memory repository."""

from __future__ import annotations

import hashlib
import re
import uuid

import numpy as np
import pytest

from app.agent.graph import build_graph
from app.agent.mcp_client import McpGateway
from app.agent.nodes import AgentDeps
from app.agent.prompts import Classification, DraftAnswer
from app.config import Settings
from app.database.connection import InMemoryLeaveRepository
from app.mcp_server.authorization import Authorizer
from app.mcp_server.server import build_server
from app.retrieval.bm25_search import tokenize
from app.retrieval.hybrid_search import HybridRetriever
from app.retrieval.ingest import ingest
from app.retrieval.vector_store import async_client
from app.security.scope import heuristic_classify

ROWS = {
    "E101": {"earned_leave_remaining": 12, "casual_leave_remaining": 4, "sick_leave_remaining": 3},
    "E102": {"earned_leave_remaining": 8, "casual_leave_remaining": 2, "sick_leave_remaining": 5},
    "E103": {"earned_leave_remaining": 15, "casual_leave_remaining": 1, "sick_leave_remaining": 2},
    "E104": {"earned_leave_remaining": 5, "casual_leave_remaining": 3, "sick_leave_remaining": 1},
    "E105": {"earned_leave_remaining": 10, "casual_leave_remaining": 0, "sick_leave_remaining": 4},
}


class HashEmbedder:
    """Bag-of-stemmed-tokens hashed into 1024 dims — deterministic, semantic-free."""

    name = "test:hash"

    def _vec(self, text: str) -> np.ndarray:
        v = np.zeros(1024, dtype=np.float32)
        for tok in tokenize(text):
            v[int(hashlib.md5(tok.encode()).hexdigest(), 16) % 1024] += 1.0
        n = np.linalg.norm(v)
        return v / n if n else v + 1e-3

    def embed_documents(self, texts):
        return np.vstack([self._vec(t) for t in texts])

    async def embed_query(self, text):
        return self._vec(text)


class OverlapReranker:
    name = "test:overlap"

    async def score(self, query, passages):
        q = set(tokenize(query))
        return [len(q & set(tokenize(p))) / (len(q) or 1) for p in passages]


class FakeLLM:
    """Classifier → heuristic classifier. Generator → quotes the first evidence passage with [S1],
    or a scripted answer (to test the output guard)."""

    generation_model = classifier_model = "fake"

    def __init__(self):
        self.scripted_answer: str | None = None
        self.calls: list[str] = []

    async def structured(self, *, system, prompt, schema, classifier=False, temperature=0.1):
        self.calls.append("classifier" if classifier else "generator")
        if schema is Classification:
            msg = re.search(r"<user_message>\n(.*)\n</user_message>", prompt, re.S).group(1)
            return Classification(**heuristic_classify(msg))
        if self.scripted_answer is not None:
            return DraftAnswer(answer=self.scripted_answer, status="answered", used_sources=[1])
        m = re.search(r'<passage id="S1"[^>]*>\n(.*?)\n</passage>', prompt, re.S)
        if not m:
            return DraftAnswer(answer="The documents do not specify this.", status="not_in_documents")
        first = m.group(1).strip().split("\n")[0]
        return DraftAnswer(answer=f"{first} [S1]", status="answered", used_sources=[1])


@pytest.fixture(scope="session")
def settings(tmp_path_factory) -> Settings:
    path = tmp_path_factory.mktemp("qdrant")
    return Settings(_env_file=None, app_env="test", qdrant_url="", qdrant_local_path=str(path), generation_api_key="",
                    session_secret="test-session-secret", mcp_identity_secret="test-mcp-secret",
                    rerank_answer_threshold=0.3, rerank_passage_threshold=0.2)


@pytest.fixture(scope="session")
def indexed(settings):
    import app.retrieval.ingest as ing

    ing.bge_token_counter = lambda _m: (lambda t: len(t.split()))  # offline token counter
    report = ingest(settings, HashEmbedder(), recreate=True)
    return report


@pytest.fixture
async def retriever(settings, indexed):
    r = HybridRetriever(settings, async_client(settings), HashEmbedder(), OverlapReranker())
    await r.load()
    yield r
    await r.client.close()


@pytest.fixture
def repo():
    return InMemoryLeaveRepository({k: dict(v) for k, v in ROWS.items()})


@pytest.fixture
async def agent(settings, retriever, repo):
    llm = FakeLLM()
    mcp = McpGateway(settings, server=build_server(repo, Authorizer(settings.mcp_identity_secret.get_secret_value())))
    await mcp.start()
    graph = build_graph(AgentDeps(settings=settings, retriever=retriever, llm=llm, mcp=mcp))

    async def ask(message: str, subject: str = "E102", role: str = "employee") -> dict:
        state = {"request_id": uuid.uuid4().hex[:8], "authenticated_subject_id": subject, "user_role": role,
                 "user_message": message, "history": [], "notices": [], "tool_calls": [], "timings": {}}
        return (await graph.ainvoke(state))["final"]

    ask.llm = llm
    ask.repo = repo
    yield ask
    await mcp.stop()
