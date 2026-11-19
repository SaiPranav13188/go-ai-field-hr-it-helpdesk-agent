"""Ingestion: Markdown policies → section chunks → BGE-M3 dense + BM25 sparse → Qdrant.

Idempotent and incremental:
  * every chunk carries a SHA-256 content hash; if a point with the same chunk ID and hash
    already exists its dense vector is reused (no re-embedding of unchanged content);
  * BM25 sparse vectors are recomputed for all chunks each run (cheap, and avgdl changes
    whenever the corpus changes);
  * points whose chunk no longer exists are deleted.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path

from qdrant_client import models

from app.config import DATA_DIR, DOCUMENTS_DIR, Settings
from app.retrieval.bge_embeddings import Embedder
from app.retrieval.bm25_search import average_doc_length, document_sparse_vector
from app.retrieval.chunking import Chunk, bge_token_counter, chunk_document, load_corpus
from app.retrieval.vector_store import DENSE, SPARSE, ensure_collection, point_id, scroll_all, sync_client

log = logging.getLogger(__name__)


@dataclass
class IngestReport:
    documents: int
    chunks: int
    embedded: int
    reused: int
    deleted: int
    avgdl: float
    seconds: float
    token_min: int
    token_max: int
    token_mean: float


def build_chunks(settings: Settings, documents_dir: Path = DOCUMENTS_DIR) -> list[Chunk]:
    count_tokens = bge_token_counter(settings.bge_m3_model)
    chunks: list[Chunk] = []
    for doc in load_corpus(documents_dir):
        chunks.extend(chunk_document(doc, count_tokens, settings.chunk_max_tokens, settings.chunk_overlap_tokens))
    return chunks


def ingest(settings: Settings, embedder: Embedder, recreate: bool = False, documents_dir: Path = DOCUMENTS_DIR) -> IngestReport:
    t0 = time.perf_counter()
    chunks = build_chunks(settings, documents_dir)
    client = sync_client(settings)
    try:
        ensure_collection(client, settings.qdrant_collection, recreate=recreate)

        existing = {
            r.payload["chunk_id"]: r
            for r in scroll_all(client, settings.qdrant_collection, with_vectors=[DENSE])
            if r.payload and "chunk_id" in r.payload
        }

        dense: dict[str, list[float]] = {}
        to_embed: list[Chunk] = []
        for ch in chunks:
            prev = existing.get(ch.chunk_id)
            if prev is not None and prev.payload.get("content_hash") == ch.content_hash and isinstance(prev.vector, dict) and DENSE in prev.vector:
                dense[ch.chunk_id] = list(prev.vector[DENSE])
            else:
                to_embed.append(ch)

        if to_embed:
            vectors = embedder.embed_documents([c.index_text for c in to_embed])
            for ch, vec in zip(to_embed, vectors):
                dense[ch.chunk_id] = vec.tolist()

        avgdl = average_doc_length([c.index_text for c in chunks])
        points = []
        for ch in chunks:
            ids, vals = document_sparse_vector(ch.index_text, avgdl)
            payload = ch.payload() | {"bm25_avgdl": avgdl}
            points.append(
                models.PointStruct(
                    id=point_id(ch.chunk_id),
                    vector={DENSE: dense[ch.chunk_id], SPARSE: models.SparseVector(indices=ids, values=vals)},
                    payload=payload,
                )
            )
        client.upsert(settings.qdrant_collection, points=points, wait=True)

        current = {c.chunk_id for c in chunks}
        stale = [point_id(cid) for cid in existing if cid not in current]
        if stale:
            client.delete(settings.qdrant_collection, points_selector=models.PointIdsList(points=stale), wait=True)
    finally:
        client.close()

    tokens = [c.token_count for c in chunks]
    report = IngestReport(
        documents=len({c.document_id for c in chunks}),
        chunks=len(chunks),
        embedded=len(to_embed),
        reused=len(chunks) - len(to_embed),
        deleted=len(stale),
        avgdl=round(avgdl, 2),
        seconds=round(time.perf_counter() - t0, 2),
        token_min=min(tokens),
        token_max=max(tokens),
        token_mean=round(sum(tokens) / len(tokens), 1),
    )
    manifest = {
        "report": report.__dict__,
        "embedding_model": settings.bge_m3_model,
        "embedder": embedder.name,
        "collection": settings.qdrant_collection,
        "chunks": [{"chunk_id": c.chunk_id, "section": c.section, "tokens": c.token_count, "hash": c.content_hash[:16]} for c in chunks],
    }
    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "ingest_manifest.json").write_text(json.dumps(manifest, indent=2))
    return report
