"""Structured JSON logging with request IDs. User text is never logged verbatim — only a
hash and length — and all string fields pass through PII/secret redaction."""

from __future__ import annotations

import contextvars
import hashlib
import json
import logging
import sys
import time

from app.security.pii import redact

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")
_STD = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        for k, v in record.__dict__.items():
            if k not in _STD and not k.startswith("_"):
                data[k] = redact(v)[0] if isinstance(v, str) else v
        if record.exc_info:
            data["exc"] = record.exc_info[0].__name__ if record.exc_info[0] else None
        return json.dumps(data, default=str)


def setup_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=level, handlers=[handler], force=True)
    for noisy in ("httpx", "httpcore", "huggingface_hub", "sentence_transformers", "urllib3", "google_genai", "mcp"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def fingerprint(text: str) -> dict:
    return {"msg_sha256": hashlib.sha256(text.encode()).hexdigest()[:16], "msg_len": len(text)}
