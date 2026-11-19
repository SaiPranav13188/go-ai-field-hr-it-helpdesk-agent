"""Build / refresh the Qdrant index from documents/*.md.

Usage:
    uv run python -m scripts.ingest_documents            # incremental
    uv run python -m scripts.ingest_documents --recreate # drop and rebuild the collection

Ingestion always embeds with the real local BGE-M3 model (requires the `local` extra).
Target Qdrant comes from QDRANT_URL / QDRANT_API_KEY (or the local on-disk store if unset).
"""

from __future__ import annotations

import argparse
import json

from app.config import get_settings
from app.retrieval.bge_embeddings import build_embedder
from app.retrieval.ingest import ingest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--recreate", action="store_true", help="drop and rebuild the collection")
    ap.add_argument("--backend", choices=["local", "hf_api"], default="local")
    args = ap.parse_args()
    settings = get_settings()
    target = settings.qdrant_url or f"local:{settings.qdrant_local_path}"
    print(f"Ingesting into Qdrant {target!r}, collection {settings.qdrant_collection!r} …")
    report = ingest(settings, build_embedder(settings, args.backend), recreate=args.recreate)
    print(json.dumps(report.__dict__, indent=2))


if __name__ == "__main__":
    main()
