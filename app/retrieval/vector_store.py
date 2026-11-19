"""Qdrant collection layout shared by ingestion and query-time retrieval.

One point per chunk, with two named vectors:
  * "dense" — BGE-M3 1024-d, cosine
  * "bm25"  — sparse BM25 term weights, Qdrant applies IDF server-side (Modifier.IDF)
The payload holds the chunk text and all citation metadata.
"""

from __future__ import annotations

import uuid

from qdrant_client import AsyncQdrantClient, QdrantClient, models

from app.config import Settings
from app.retrieval.bge_embeddings import DENSE_DIM

DENSE = "dense"
SPARSE = "bm25"


def point_id(chunk_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"go-ai-field-helpdesk/{chunk_id}"))


def _client_kwargs(settings: Settings) -> dict:
    if settings.qdrant_url:
        return {"url": settings.qdrant_url, "api_key": settings.qdrant_api_key.get_secret_value() or None, "timeout": 15}
    return {"path": settings.qdrant_local_path}


def sync_client(settings: Settings) -> QdrantClient:
    return QdrantClient(**_client_kwargs(settings))


def async_client(settings: Settings) -> AsyncQdrantClient:
    return AsyncQdrantClient(**_client_kwargs(settings))


def ensure_collection(client: QdrantClient, name: str, recreate: bool = False) -> None:
    if recreate and client.collection_exists(name):
        client.delete_collection(name)
    if client.collection_exists(name):
        return
    client.create_collection(
        collection_name=name,
        vectors_config={DENSE: models.VectorParams(size=DENSE_DIM, distance=models.Distance.COSINE)},
        sparse_vectors_config={SPARSE: models.SparseVectorParams(modifier=models.Modifier.IDF)},
    )
    for field in ("document_id", "chunk_id", "content_hash"):
        try:
            client.create_payload_index(name, field_name=field, field_schema=models.PayloadSchemaType.KEYWORD)
        except Exception:  # local mode does not support payload indexes; harmless
            pass


def scroll_all(client: QdrantClient, name: str, with_vectors: bool | list[str] = False) -> list[models.Record]:
    records: list[models.Record] = []
    offset = None
    while True:
        batch, offset = client.scroll(name, limit=256, offset=offset, with_payload=True, with_vectors=with_vectors)
        records.extend(batch)
        if offset is None:
            return records
