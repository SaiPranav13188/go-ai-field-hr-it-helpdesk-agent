"""Cross-encoder reranking with BAAI/bge-reranker-v2-m3.

The reranker reads (query, passage) *together* and outputs a relevance probability in [0, 1]
(sigmoid of the model logit). It is only applied to the fused first-stage candidates, never
to the whole collection.
"""

from __future__ import annotations

import asyncio
import logging
import math
import threading
from typing import Protocol

import httpx

from app.config import Settings
from app.retrieval.bge_embeddings import RemoteServiceClient, remote_client, resolve_backend, torch_device

log = logging.getLogger(__name__)


class Reranker(Protocol):
    name: str

    async def score(self, query: str, passages: list[str]) -> list[float]: ...


class LocalBGEReranker:
    def __init__(self, model_name: str, max_length: int = 1024):
        self.name = f"local:{model_name}"
        self._model_name = model_name
        self._max_length = max_length
        self._model = None
        self._lock = threading.Lock()

    def _load(self):
        with self._lock:
            if self._model is None:
                from sentence_transformers import CrossEncoder

                # CrossEncoder applies Sigmoid for single-label models → probabilities in [0, 1].
                self._model = CrossEncoder(self._model_name, device=torch_device(), max_length=self._max_length)
        return self._model

    def score_sync(self, query: str, passages: list[str]) -> list[float]:
        if not passages:
            return []
        scores = self._load().predict([(query, p) for p in passages], batch_size=16, show_progress_bar=False)
        return [float(s) for s in scores]

    async def score(self, query: str, passages: list[str]) -> list[float]:
        return await asyncio.to_thread(self.score_sync, query, passages)

    def warmup(self) -> None:
        self.score_sync("warmup", ["warmup"])


class HFApiBGEReranker:
    """Text-classification endpoint with (text, text_pair) inputs for the same model."""

    def __init__(self, model_name: str, token: str, timeout: float = 20.0, concurrency: int = 8):
        if not token:
            raise RuntimeError("HF_TOKEN is required for the hf_api model backend")
        self.name = f"hf_api:{model_name}"
        self._url = f"https://router.huggingface.co/hf-inference/models/{model_name}"
        self._headers = {"Authorization": f"Bearer {token}"}
        self._timeout = timeout
        self._sem = asyncio.Semaphore(concurrency)

    @staticmethod
    def _extract(item) -> float:
        # Responses are [{"label": "LABEL_0", "score": p}] (sigmoid applied) or nested lists.
        while isinstance(item, list):
            item = item[0]
        score = float(item["score"])
        return score if 0.0 <= score <= 1.0 else 1 / (1 + math.exp(-score))

    async def _one(self, client: httpx.AsyncClient, query: str, passage: str) -> float:
        payload = {"inputs": {"text": query, "text_pair": passage}, "parameters": {"function_to_apply": "sigmoid"}}
        async with self._sem:
            for attempt in range(3):
                resp = await client.post(self._url, json=payload, headers=self._headers)
                if resp.status_code in (429, 503) and attempt < 2:
                    await asyncio.sleep(1.5 * (attempt + 1))
                    continue
                resp.raise_for_status()
                return self._extract(resp.json())
        raise RuntimeError("unreachable")

    async def score(self, query: str, passages: list[str]) -> list[float]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            return list(await asyncio.gather(*(self._one(client, query, p) for p in passages)))

    def warmup(self) -> None:
        asyncio.run(self.score("warmup", ["warmup"]))


class RemoteBGEReranker:
    def __init__(self, client: RemoteServiceClient, model_name: str):
        self.name = f"remote:{model_name}"
        self._c = client

    async def score(self, query: str, passages: list[str]) -> list[float]:
        if not passages:
            return []
        return [float(x) for x in (await self._c.post("/rerank", {"query": query, "passages": passages}))["scores"]]

    def warmup(self) -> None:
        self._c.post_sync("/rerank", {"query": "warmup", "passages": ["warmup"]})


def build_reranker(settings: Settings, backend: str | None = None) -> Reranker:
    backend = backend or resolve_backend(settings)
    if backend == "local":
        return LocalBGEReranker(settings.bge_reranker_model)
    if backend == "remote":
        return RemoteBGEReranker(remote_client(settings), settings.bge_reranker_model)
    return HFApiBGEReranker(settings.bge_reranker_model, settings.hf_token.get_secret_value())
