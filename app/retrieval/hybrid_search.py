"""Query-time hybrid retrieval pipeline.

    query preparation → [BGE-M3 dense ‖ BM25] (parallel, Qdrant) → RRF → metadata constraints
    → BGE reranker v2 m3 → top passages

Every stage is timed and its intermediate ranking is kept, so the UI can show exactly how a
passage moved from first-stage retrieval to the final evidence set, and so evaluation can
measure each baseline (BM25-only, dense-only, RRF, RRF+rerank) with the same code path.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from qdrant_client import AsyncQdrantClient, models

from app.config import Settings
from app.retrieval.bge_embeddings import Embedder
from app.retrieval.bm25_search import query_sparse_vector
from app.retrieval.fusion import reciprocal_rank_fusion
from app.retrieval.reranker import Reranker
from app.retrieval.vector_store import DENSE, SPARSE

log = logging.getLogger(__name__)

Mode = Literal["bm25", "dense", "hybrid", "hybrid_rerank"]

# Identifiers that must survive any query rewriting: document IDs, error codes, acronyms.
_IDENTIFIER_RE = re.compile(r"\b(?:[A-Z]{2,}(?:-[A-Z0-9]+)+|[A-Z]{2,}-?\d{2,}|[A-Z]{2,6})\b")


def prepare_query(original: str, rewritten: str | None = None) -> str:
    """Use the standalone (context-resolved) query but never lose exact identifiers."""
    base = (rewritten or original).strip()
    missing = [tok for tok in dict.fromkeys(_IDENTIFIER_RE.findall(original)) if tok.lower() not in base.lower()]
    return f"{base} {' '.join(missing)}".strip() if missing else base


@dataclass
class Candidate:
    chunk_id: str
    payload: dict
    dense_rank: int | None = None
    dense_score: float | None = None
    bm25_rank: int | None = None
    bm25_score: float | None = None
    rrf_rank: int | None = None
    rrf_score: float | None = None
    rerank_score: float | None = None
    final_rank: int | None = None

    def public(self) -> dict:
        p = self.payload
        return {
            "chunk_id": self.chunk_id,
            "document_id": p["document_id"],
            "document_title": p["document_title"],
            "section": p["section"],
            "dense_rank": self.dense_rank,
            "dense_score": _r(self.dense_score),
            "bm25_rank": self.bm25_rank,
            "bm25_score": _r(self.bm25_score),
            "rrf_rank": self.rrf_rank,
            "rrf_score": _r(self.rrf_score, 5),
            "rerank_score": _r(self.rerank_score),
            "final_rank": self.final_rank,
        }


def _r(v: float | None, n: int = 4) -> float | None:
    return None if v is None else round(float(v), n)


@dataclass
class RetrievalResult:
    query: str
    mode: Mode
    ranked: list[Candidate]  # final order for this mode
    candidates: list[Candidate]  # every candidate considered (for tracing)
    timings_ms: dict[str, float] = field(default_factory=dict)
    dropped_by_metadata: list[str] = field(default_factory=list)

    @property
    def top_score(self) -> float:
        if not self.ranked:
            return 0.0
        return self.ranked[0].rerank_score or 0.0


class HybridRetriever:
    def __init__(self, settings: Settings, client: AsyncQdrantClient, embedder: Embedder, reranker: Reranker | None):
        self.s = settings
        self.client = client
        self.embedder = embedder
        self.reranker = reranker
        self.chunks: dict[str, dict] = {}

    async def load(self) -> int:
        """Cache chunk payloads (small corpus) for metadata checks and citation rendering."""
        self.chunks.clear()
        offset = None
        while True:
            batch, offset = await self.client.scroll(self.s.qdrant_collection, limit=256, offset=offset, with_payload=True)
            for rec in batch:
                self.chunks[rec.payload["chunk_id"]] = rec.payload
            if offset is None:
                break
        return len(self.chunks)

    # ---- first-stage channels --------------------------------------------------
    async def dense_search(self, query: str, k: int) -> tuple[list[tuple[str, float]], float]:
        t = time.perf_counter()
        vec = await self.embedder.embed_query(query)
        res = await self.client.query_points(self.s.qdrant_collection, query=vec.tolist(), using=DENSE, limit=k, with_payload=["chunk_id"])
        return [(p.payload["chunk_id"], p.score) for p in res.points], (time.perf_counter() - t) * 1000

    async def bm25_search(self, query: str, k: int) -> tuple[list[tuple[str, float]], float]:
        t = time.perf_counter()
        ids, vals = query_sparse_vector(query)
        if not ids:
            return [], 0.0
        res = await self.client.query_points(
            self.s.qdrant_collection, query=models.SparseVector(indices=ids, values=vals), using=SPARSE, limit=k, with_payload=["chunk_id"]
        )
        return [(p.payload["chunk_id"], p.score) for p in res.points if p.score > 0], (time.perf_counter() - t) * 1000

    # ---- metadata constraints ------------------------------------------------------
    def apply_metadata_constraints(self, cands: list[Candidate], today: date | None = None) -> tuple[list[Candidate], list[str]]:
        """Drop not-yet-effective or superseded chunks; if one document appears in several
        versions keep only the highest active version (conflict resolution, spec §10.4)."""
        today = today or date.today()
        latest: dict[str, tuple[int, ...]] = {}
        for c in cands:
            latest[c.payload["document_id"]] = max(latest.get(c.payload["document_id"], (0,)), _version(c.payload.get("version", "0")))
        kept, dropped = [], []
        for c in cands:
            p = c.payload
            status = str(p.get("status", "")).lower()
            effective = _parse_date(p.get("effective_date"))
            if ("superseded" in status or "draft" in status or (effective and effective > today)
                    or _version(p.get("version", "0")) < latest[p["document_id"]]):
                dropped.append(c.chunk_id)
            else:
                kept.append(c)
        return kept, dropped

    # ---- full pipeline -----------------------------------------------------------------
    async def retrieve(self, query: str, mode: Mode = "hybrid_rerank", top_n: int | None = None) -> RetrievalResult:
        s = self.s
        timings: dict[str, float] = {}
        t_all = time.perf_counter()
        top_n = top_n or s.rerank_context_passages

        dense_hits: list[tuple[str, float]] = []
        bm25_hits: list[tuple[str, float]] = []
        if mode == "dense":
            dense_hits, timings["dense_ms"] = await self.dense_search(query, s.dense_candidates)
        elif mode == "bm25":
            bm25_hits, timings["bm25_ms"] = await self.bm25_search(query, s.bm25_candidates)
        else:
            t = time.perf_counter()
            (dense_hits, timings["dense_ms"]), (bm25_hits, timings["bm25_ms"]) = await asyncio.gather(
                self.dense_search(query, s.dense_candidates), self.bm25_search(query, s.bm25_candidates)
            )
            timings["first_stage_ms"] = (time.perf_counter() - t) * 1000

        cands: dict[str, Candidate] = {}

        def cand(cid: str) -> Candidate:
            return cands.setdefault(cid, Candidate(chunk_id=cid, payload=self.chunks.get(cid, {})))

        for i, (cid, sc) in enumerate(dense_hits, 1):
            c = cand(cid); c.dense_rank, c.dense_score = i, sc
        for i, (cid, sc) in enumerate(bm25_hits, 1):
            c = cand(cid); c.bm25_rank, c.bm25_score = i, sc

        if mode == "dense":
            ordered = [cands[cid] for cid, _ in dense_hits]
        elif mode == "bm25":
            ordered = [cands[cid] for cid, _ in bm25_hits]
        else:
            t = time.perf_counter()
            fused = reciprocal_rank_fusion({"dense": dense_hits, "bm25": bm25_hits}, k=s.rrf_k, limit=s.fused_candidates)
            timings["rrf_ms"] = (time.perf_counter() - t) * 1000
            ordered = []
            for i, h in enumerate(fused, 1):
                c = cands[h.chunk_id]; c.rrf_rank, c.rrf_score = i, h.rrf_score
                ordered.append(c)

        ordered = [c for c in ordered if c.payload]
        ordered, dropped = self.apply_metadata_constraints(ordered)
        for i, c in enumerate(ordered, 1):
            c.final_rank = i
        timings["retrieval_total_ms"] = (time.perf_counter() - t_all) * 1000
        result = RetrievalResult(
            query=query,
            mode=mode,
            ranked=ordered,
            candidates=list(cands.values()),
            timings_ms={k: round(v, 1) for k, v in timings.items()},
            dropped_by_metadata=dropped,
        )
        if mode == "hybrid_rerank":
            await self.rerank(result)
        return result

    async def first_stage(self, query: str) -> RetrievalResult:
        """Dense ‖ BM25 → RRF → metadata constraints (no reranking)."""
        return await self.retrieve(query, mode="hybrid")

    async def rerank(self, result: RetrievalResult) -> RetrievalResult:
        """Second stage: cross-encoder scores for the fused candidates, reorder in place."""
        if not self.reranker or not result.ranked:
            return result
        t = time.perf_counter()
        scores = await self.reranker.score(result.query, [c.payload["index_text"] for c in result.ranked])
        for c, sc in zip(result.ranked, scores):
            c.rerank_score = sc
        result.ranked.sort(key=lambda c: -(c.rerank_score or 0.0))
        for i, c in enumerate(result.ranked, 1):
            c.final_rank = i
        ms = (time.perf_counter() - t) * 1000
        result.timings_ms["rerank_ms"] = round(ms, 1)
        result.timings_ms["retrieval_total_ms"] = round(result.timings_ms.get("retrieval_total_ms", 0) + ms, 1)
        result.mode = "hybrid_rerank"
        return result

    def select_evidence(self, result: RetrievalResult) -> tuple[list[Candidate], bool]:
        """Evidence gate (calibrated in evaluation/retrieval_metrics.md). Returns (evidence, sufficient).

        Strong evidence: the best reranked passage clears RERANK_ANSWER_THRESHOLD.
        Weak evidence:  the cross-encoder is unsure, but the SAME chunk is ranked #1 by both
                        independent first-stage channels (dense and BM25). This catches on-topic
                        questions whose specific fact is missing (e.g. an exact coverage amount),
                        so the generator can cite the related section and say what is NOT specified.
        Passing the gate never means "answerable" — the generator must still return
        partial/not_in_documents, and the output guard enforces grounding.
        """
        s = self.s
        if not result.ranked:
            return [], False
        top = result.ranked[0]
        if (top.rerank_score or 0.0) >= s.rerank_answer_threshold:
            evidence = [c for c in result.ranked[: s.rerank_context_passages] if (c.rerank_score or 0.0) >= s.rerank_passage_threshold]
            return evidence[: s.max_citations], True
        agreed = [c for c in result.ranked if c.dense_rank == 1 and c.bm25_rank == 1]
        if agreed and (agreed[0].rerank_score or 0.0) >= s.rerank_answer_threshold / 10:
            return agreed[:1], True
        return [], False


def _version(v: str) -> tuple[int, ...]:
    try:
        return tuple(int(x) for x in str(v).split("."))
    except ValueError:
        return (0,)


def _parse_date(v) -> date | None:
    try:
        return date.fromisoformat(str(v))
    except (TypeError, ValueError):
        return None
