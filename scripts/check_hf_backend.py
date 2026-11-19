"""Verify that a hosted backend (default: our model service on the HF Space) serves the SAME models as local.

Production (Render) embeds queries and reranks through the HF API, while document vectors were
produced locally at ingestion. This script measures the agreement so the claim is checked, not
assumed:  uv run python -m scripts.check_hf_backend
"""

from __future__ import annotations

import asyncio

import numpy as np

from app.config import get_settings
from app.retrieval.bge_embeddings import build_embedder
from app.retrieval.reranker import build_reranker

QUERIES = ["How many earned leave days are provided annually?", "My VPN is not connecting", "मुझे कितनी छुट्टियाँ मिलती हैं?"]
PAIRS = [
    ("How many earned leave days are provided annually?", "Earned leave | 18 working days | Up to 5 unused days"),
    ("How many earned leave days are provided annually?", "Restart the VPN client and try again."),
    ("Do I need MFA?", "Enable multi-factor authentication (MFA) wherever supported."),
]


async def main() -> None:
    import sys

    s = get_settings()
    hosted = sys.argv[1] if len(sys.argv) > 1 else "remote"
    local_e, api_e = build_embedder(s, "local"), build_embedder(s, hosted)
    print("Embedding agreement (cosine, local vs hosted):")
    for q in QUERIES:
        a, b = await local_e.embed_query(q), await api_e.embed_query(q)
        print(f"  {float(np.dot(a, b)):.5f}  {q}")
    local_r, api_r = build_reranker(s, "local"), build_reranker(s, hosted)
    print("Reranker agreement (probability, local vs hosted):")
    for q, p in PAIRS:
        a, b = (await local_r.score(q, [p]))[0], (await api_r.score(q, [p]))[0]
        print(f"  local {a:.4f}  api {b:.4f}  Δ {abs(a - b):.4f}  | {q[:40]} ↔ {p[:40]}")


if __name__ == "__main__":
    asyncio.run(main())
