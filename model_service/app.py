"""BGE model service (runs on a free Hugging Face Space, CPU).

Serves the SAME weights the agent uses locally:
  POST /embed   {"texts": [...]}                  -> {"vectors": [[...1024 floats...], ...]}   (BAAI/bge-m3, L2-normalised)
  POST /rerank  {"query": "...", "passages": [...]} -> {"scores": [p, ...]}                     (BAAI/bge-reranker-v2-m3, sigmoid)
Every request must send `Authorization: Bearer <MODEL_SERVICE_KEY>` (a Space secret).
"""

import hmac
import os
import time

import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import CrossEncoder, SentenceTransformer

torch.set_num_threads(max(1, os.cpu_count() or 1))
KEY = os.environ.get("MODEL_SERVICE_KEY", "")
EMBED_MODEL = os.environ.get("BGE_M3_MODEL", "BAAI/bge-m3")
RERANK_MODEL = os.environ.get("BGE_RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")

app = FastAPI(title="BGE model service", docs_url=None, redoc_url=None)
embedder = SentenceTransformer(EMBED_MODEL, device="cpu")
reranker = CrossEncoder(RERANK_MODEL, device="cpu", max_length=512)


def auth(authorization: str | None = Header(default=None)) -> None:
    if not KEY:
        raise HTTPException(503, "MODEL_SERVICE_KEY not configured")
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(token, KEY):
        raise HTTPException(401, "unauthorised")


class EmbedIn(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=32)


class RerankIn(BaseModel):
    query: str = Field(max_length=4000)
    passages: list[str] = Field(min_length=1, max_length=40)


@app.get("/")
def health():
    return {"ok": True, "embed": EMBED_MODEL, "rerank": RERANK_MODEL}


@app.post("/embed", dependencies=[Depends(auth)])
def embed(body: EmbedIn):
    t = time.perf_counter()
    vecs = embedder.encode([x[:8000] for x in body.texts], normalize_embeddings=True, batch_size=16, show_progress_bar=False)
    return {"vectors": vecs.tolist(), "ms": round((time.perf_counter() - t) * 1000, 1)}


@app.post("/rerank", dependencies=[Depends(auth)])
def rerank(body: RerankIn):
    t = time.perf_counter()
    scores = reranker.predict([(body.query, p[:4000]) for p in body.passages], batch_size=16, show_progress_bar=False)
    return {"scores": [float(s) for s in scores], "ms": round((time.perf_counter() - t) * 1000, 1)}
