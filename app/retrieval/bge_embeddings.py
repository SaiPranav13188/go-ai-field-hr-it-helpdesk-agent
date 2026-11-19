"""BGE-M3 dense embeddings.

Two interchangeable backends serving the *same* model weights (`BAAI/bge-m3`):

* LocalBGEM3   — sentence-transformers in-process (development, ingestion, evaluation).
* HFApiBGEM3   — Hugging Face Inference API (production on a small Render instance that
                 cannot hold the 2.2 GB model in RAM).

Document vectors are always produced by ingestion; at query time only the short user query
is embedded. Vectors are L2-normalised, so cosine similarity == dot product.
"""

from __future__ import annotations

import asyncio
import importlib.util
import logging
import threading
from typing import Protocol

import numpy as np

from app.config import Settings

log = logging.getLogger(__name__)
DENSE_DIM = 1024


class Embedder(Protocol):
    name: str

    def embed_documents(self, texts: list[str]) -> np.ndarray: ...
    async def embed_query(self, text: str) -> np.ndarray: ...


def _normalise(v: np.ndarray) -> np.ndarray:
    v = np.asarray(v, dtype=np.float32)
    if v.ndim == 1:
        return v / (np.linalg.norm(v) or 1.0)
    return v / np.clip(np.linalg.norm(v, axis=1, keepdims=True), 1e-12, None)


def torch_device() -> str:
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class LocalBGEM3:
    def __init__(self, model_name: str):
        self.name = f"local:{model_name}"
        self._model_name = model_name
        self._model = None
        self._lock = threading.Lock()

    def _load(self):
        with self._lock:
            if self._model is None:
                from sentence_transformers import SentenceTransformer

                self._model = SentenceTransformer(self._model_name, device=torch_device())
        return self._model

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        model = self._load()
        return _normalise(model.encode(texts, batch_size=8, normalize_embeddings=True, show_progress_bar=False))

    async def embed_query(self, text: str) -> np.ndarray:
        model = self._load()
        vec = await asyncio.to_thread(model.encode, [text], normalize_embeddings=True, show_progress_bar=False)
        return _normalise(vec[0])

    def warmup(self) -> None:
        self._load().encode(["warmup"], normalize_embeddings=True, show_progress_bar=False)


class HFApiBGEM3:
    def __init__(self, model_name: str, token: str, timeout: float = 20.0):
        from huggingface_hub import InferenceClient

        if not token:
            raise RuntimeError("HF_TOKEN is required for the hf_api model backend")
        self.name = f"hf_api:{model_name}"
        self._model_name = model_name
        self._client = InferenceClient(provider="hf-inference", api_key=token, timeout=timeout)

    def _call(self, texts: list[str]) -> np.ndarray:
        out = np.asarray(self._client.feature_extraction(texts, model=self._model_name), dtype=np.float32)
        if out.ndim == 3:  # token-level output → CLS pooling (BGE-M3 dense uses the CLS vector)
            out = out[:, 0, :]
        return _normalise(out)

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        return np.vstack([self._call(texts[i : i + 16]) for i in range(0, len(texts), 16)])

    async def embed_query(self, text: str) -> np.ndarray:
        for attempt in range(3):
            try:
                return (await asyncio.to_thread(self._call, [text]))[0]
            except Exception as exc:  # cold-start 503s are common on serverless inference
                if attempt == 2:
                    raise
                log.warning("hf_embed_retry", extra={"attempt": attempt + 1, "error": type(exc).__name__})
                await asyncio.sleep(1.5 * (attempt + 1))
        raise RuntimeError("unreachable")

    def warmup(self) -> None:
        self._call(["warmup"])


class RemoteServiceClient:
    """Shared HTTP client for the self-hosted BGE model service (model_service/), with retries for
    cold starts — a sleeping free Space answers 503 until it has woken up."""

    def __init__(self, url: str, key: str, timeout: float = 30.0):
        import httpx

        if not url or not key:
            raise RuntimeError("MODEL_SERVICE_URL and MODEL_SERVICE_KEY are required for the remote model backend")
        self._client = httpx.AsyncClient(base_url=url.rstrip("/"), timeout=timeout, headers={"Authorization": f"Bearer {key}"})
        self._sync = httpx.Client(base_url=url.rstrip("/"), timeout=timeout, headers={"Authorization": f"Bearer {key}"})

    async def post(self, path: str, payload: dict) -> dict:
        for attempt in range(4):
            try:
                r = await self._client.post(path, json=payload)
                if r.status_code in (502, 503, 504) and attempt < 3:
                    await asyncio.sleep(3 * (attempt + 1))
                    continue
                r.raise_for_status()
                return r.json()
            except Exception as exc:
                if attempt == 3 or getattr(getattr(exc, "response", None), "status_code", 0) in (400, 401, 422):
                    raise
                await asyncio.sleep(3 * (attempt + 1))
        raise RuntimeError("unreachable")

    def post_sync(self, path: str, payload: dict) -> dict:
        r = self._sync.post(path, json=payload)
        r.raise_for_status()
        return r.json()


_remote_clients: dict[str, RemoteServiceClient] = {}


def remote_client(settings: Settings) -> RemoteServiceClient:
    url = settings.model_service_url
    if url not in _remote_clients:
        _remote_clients[url] = RemoteServiceClient(url, settings.model_service_key.get_secret_value())
    return _remote_clients[url]


class RemoteBGEM3:
    def __init__(self, client: RemoteServiceClient, model_name: str):
        self.name = f"remote:{model_name}"
        self._c = client

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        out = [self._c.post_sync("/embed", {"texts": texts[i : i + 32]})["vectors"] for i in range(0, len(texts), 32)]
        return _normalise(np.vstack([np.asarray(o, dtype=np.float32) for o in out]))

    async def embed_query(self, text: str) -> np.ndarray:
        return _normalise(np.asarray((await self._c.post("/embed", {"texts": [text]}))["vectors"][0], dtype=np.float32))

    def warmup(self) -> None:
        self._c.post_sync("/embed", {"texts": ["warmup"]})


def resolve_backend(settings: Settings) -> str:
    if settings.model_backend != "auto":
        return settings.model_backend
    return "local" if importlib.util.find_spec("sentence_transformers") else "hf_api"


def build_embedder(settings: Settings, backend: str | None = None) -> Embedder:
    backend = backend or resolve_backend(settings)
    if backend == "local":
        return LocalBGEM3(settings.bge_m3_model)
    if backend == "remote":
        return RemoteBGEM3(remote_client(settings), settings.bge_m3_model)
    return HFApiBGEM3(settings.bge_m3_model, settings.hf_token.get_secret_value())
