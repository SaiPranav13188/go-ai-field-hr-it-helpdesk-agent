"""Central configuration loaded from environment variables / .env.

Secrets are only ever read from the environment. Nothing in this module logs values.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parent.parent
DOCUMENTS_DIR = ROOT_DIR / "documents"
DATA_DIR = ROOT_DIR / "data"
EVALUATION_DIR = ROOT_DIR / "evaluation"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    frontend_origins: str = "http://localhost:3000"

    # --- Signing secrets -------------------------------------------------
    # SESSION_SECRET signs the simulated browser session token.
    # MCP_IDENTITY_SECRET signs the short-lived identity assertion the backend hands
    # to the MCP server. The MCP server only trusts identities carrying this signature.
    session_secret: SecretStr = SecretStr("dev-only-session-secret-change-me")
    mcp_identity_secret: SecretStr = SecretStr("dev-only-mcp-identity-secret-change-me")
    session_ttl_seconds: int = 8 * 3600

    # --- Generation model ------------------------------------------------
    generation_provider: Literal["gemini"] = "gemini"
    generation_model: str = "gemini-3.5-flash-lite"
    classifier_model: str = "gemini-3.1-flash-lite"  # fast, low-latency routing; falls back to generation_model
    generation_fallback_model: str = "gemini-3.1-flash-lite"  # used if the primary model is overloaded or times out
    generation_api_key: SecretStr = SecretStr("")
    generation_timeout_seconds: float = 25.0

    # --- Retrieval models ------------------------------------------------
    # "local": sentence-transformers in-process (needs the optional `local` extra).
    # "hf_api": the same BAAI models through the Hugging Face Inference API.
    # "auto": local when sentence-transformers is importable, otherwise hf_api.
    # "remote": our own model service (model_service/ on a free Hugging Face Space) serving the same weights.
    model_backend: Literal["auto", "local", "hf_api", "remote"] = "auto"
    model_service_url: str = ""
    model_service_key: SecretStr = SecretStr("")
    hf_token: SecretStr = SecretStr("")
    bge_m3_model: str = "BAAI/bge-m3"
    bge_reranker_model: str = "BAAI/bge-reranker-v2-m3"

    # --- Qdrant ----------------------------------------------------------
    qdrant_url: str = ""
    qdrant_api_key: SecretStr = SecretStr("")
    qdrant_collection: str = "hr_it_policies"
    qdrant_local_path: str = str(DATA_DIR / "qdrant_local")

    # --- PostgreSQL (used ONLY by the MCP server process) ---------------
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "postgres"
    postgres_user: str = "helpdesk_readonly"
    postgres_password: SecretStr = SecretStr("")
    postgres_sslmode: str = "require"
    postgres_connect_timeout: int = 5
    postgres_statement_timeout_ms: int = 3000

    # --- Retrieval parameters (starting values from the spec; measured in evaluation/) ---
    dense_candidates: int = 20
    bm25_candidates: int = 20
    rrf_k: int = 60
    fused_candidates: int = 25
    rerank_context_passages: int = 5
    max_citations: int = 6
    # Calibrated on evaluation/retrieval_queries.json — see evaluation/retrieval_metrics.md
    rerank_answer_threshold: float = Field(default=0.002)
    rerank_passage_threshold: float = Field(default=0.002)
    chunk_max_tokens: int = 650
    chunk_overlap_tokens: int = 80

    # --- API hardening ---------------------------------------------------
    max_message_chars: int = 2000
    chat_rate_limit_per_minute: int = 20

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.frontend_origins.split(",") if o.strip()]

    @property
    def effective_classifier_model(self) -> str:
        return self.classifier_model or self.generation_model


@lru_cache
def get_settings() -> Settings:
    return Settings()
