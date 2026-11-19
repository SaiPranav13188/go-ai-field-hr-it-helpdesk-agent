"""MCP client gateway used by the agent.

The MCP server runs as a separate child process (stdio transport). Only that process gets the
PostgreSQL credentials; the agent process holds none of them at runtime. One long-lived MCP
session is owned by a dedicated background task (so the transport's async context is entered
and exited in the same task) and is transparently restarted if the child process dies.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from typing import Any

from mcp import Client
from mcp.client.stdio import StdioServerParameters

from app.config import ROOT_DIR, Settings

log = logging.getLogger(__name__)

# Env vars the MCP child process needs — and nothing else (no LLM / HF / Qdrant keys).
_CHILD_ENV_KEYS = ("POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD",
                   "POSTGRES_SSLMODE", "POSTGRES_CONNECT_TIMEOUT", "POSTGRES_STATEMENT_TIMEOUT_MS",
                   "MCP_IDENTITY_SECRET", "PATH", "HOME", "LANG", "PYTHONPATH", "SSL_CERT_FILE")


class ToolUnavailable(Exception):
    pass


class McpGateway:
    def __init__(self, settings: Settings, server: Any | None = None):
        """`server` may be an in-process MCPServer (tests); otherwise a stdio child is spawned."""
        self.s = settings
        self._server = server
        self._client: Client | None = None
        self._ready = asyncio.Event()
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None
        self.last_error: str | None = None

    def _params(self) -> StdioServerParameters:
        env = {k: v for k, v in os.environ.items() if k in _CHILD_ENV_KEYS}
        # values may come from .env rather than the process env
        s = self.s
        env.update({
            "POSTGRES_HOST": s.postgres_host, "POSTGRES_PORT": str(s.postgres_port), "POSTGRES_DB": s.postgres_db,
            "POSTGRES_USER": s.postgres_user, "POSTGRES_PASSWORD": s.postgres_password.get_secret_value(),
            "POSTGRES_SSLMODE": s.postgres_sslmode, "MCP_IDENTITY_SECRET": s.mcp_identity_secret.get_secret_value(),
            "APP_ENV": s.app_env, "HELPDESK_MCP_CHILD": "1",
        })
        return StdioServerParameters(command=sys.executable, args=["-m", "app.mcp_server.server"], env=env, cwd=str(ROOT_DIR))

    async def start(self, wait: float = 20.0) -> None:
        self._task = asyncio.create_task(self._run(), name="mcp-gateway")
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=wait)
        except asyncio.TimeoutError:
            log.warning("mcp_gateway_slow_start")

    async def _run(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                target = self._server if self._server is not None else self._params()
                async with Client(target, read_timeout_seconds=15) as client:
                    self._client = client
                    self.last_error = None
                    self._ready.set()
                    backoff = 1.0
                    log.info("mcp_gateway_connected")
                    await self._stop.wait()
            except Exception as exc:  # child crashed or failed to start
                self.last_error = type(exc).__name__
                log.error("mcp_gateway_error", extra={"error": type(exc).__name__})
            finally:
                self._client = None
                self._ready.clear()
            if not self._stop.is_set():
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except (asyncio.TimeoutError, Exception):
                self._task.cancel()

    @property
    def connected(self) -> bool:
        return self._client is not None

    async def list_tools(self) -> list[str]:
        if not self._client:
            raise ToolUnavailable("MCP server not connected")
        return [t.name for t in (await self._client.list_tools()).tools]

    async def call(self, name: str, arguments: dict, timeout: float = 10.0) -> tuple[dict, float]:
        if not self._client:
            try:
                await asyncio.wait_for(self._ready.wait(), timeout=5)
            except asyncio.TimeoutError:
                raise ToolUnavailable("MCP server not connected")
        client = self._client
        if client is None:
            raise ToolUnavailable("MCP server not connected")
        t = time.perf_counter()
        try:
            result = await asyncio.wait_for(client.call_tool(name, arguments), timeout=timeout)
        except Exception as exc:
            raise ToolUnavailable(type(exc).__name__) from exc
        ms = (time.perf_counter() - t) * 1000
        if result.is_error or not isinstance(result.structured_content, dict):
            return {"status": "invalid_input", "message": "tool rejected the request"}, ms
        return result.structured_content, ms
