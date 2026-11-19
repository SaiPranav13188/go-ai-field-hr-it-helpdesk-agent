"""Generation-model client (Google Gemini) returning schema-validated structured output."""

from __future__ import annotations

import asyncio
import logging
from typing import TypeVar

from pydantic import BaseModel

from app.config import Settings

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)


class LLMUnavailable(Exception):
    pass


class GeminiLLM:
    def __init__(self, settings: Settings):
        from google import genai

        key = settings.generation_api_key.get_secret_value()
        if not key:
            raise LLMUnavailable("GENERATION_API_KEY is not configured")
        self._client = genai.Client(api_key=key)
        self.generation_model = settings.generation_model
        self.classifier_model = settings.effective_classifier_model
        self.fallback_model = settings.generation_fallback_model
        self._timeout = settings.generation_timeout_seconds

    @staticmethod
    def _thinking(model: str, light: bool):
        from google.genai import types

        m = model.lower()
        if "gemini-2.5" in m:
            # 2.5 Flash/Flash-Lite allow disabling thinking; Pro requires a budget.
            return types.ThinkingConfig(thinking_budget=128 if "pro" in m else (0 if light else 256))
        if "gemini-3" in m:
            # MINIMAL is only accepted by the lite models; full flash/pro models take LOW.
            return types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL if "lite" in m else types.ThinkingLevel.LOW)
        return None

    async def structured(self, *, system: str, prompt: str, schema: type[T], classifier: bool = False, temperature: float = 0.1) -> T:
        from google.genai import errors, types

        primary = self.classifier_model if classifier else self.generation_model
        models = [primary] + ([self.fallback_model] if self.fallback_model and self.fallback_model != primary else [])
        last_exc: Exception | None = None
        for model in models:
            config = types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                response_schema=schema,
                temperature=temperature,
                max_output_tokens=1500,
                thinking_config=self._thinking(model, light=classifier),
            )
            for attempt in range(2):
                try:
                    resp = await asyncio.wait_for(
                        self._client.aio.models.generate_content(model=model, contents=prompt, config=config), timeout=self._timeout
                    )
                    if isinstance(resp.parsed, schema):
                        return resp.parsed
                    if resp.text:
                        return schema.model_validate_json(resp.text)
                    raise ValueError("empty response")
                except errors.APIError as exc:
                    last_exc = exc
                    if getattr(exc, "code", None) == 429 and attempt == 0:
                        await asyncio.sleep(2.0)
                        continue
                    break  # 4xx/5xx/overload → move on to the fallback model
                except (asyncio.TimeoutError, ValueError) as exc:
                    last_exc = exc
                    break
            log.warning("llm_model_failed", extra={"model": model, "error": type(last_exc).__name__})
        log.warning("llm_call_failed", extra={"error": type(last_exc).__name__})
        raise LLMUnavailable(type(last_exc).__name__ if last_exc else "unknown")
