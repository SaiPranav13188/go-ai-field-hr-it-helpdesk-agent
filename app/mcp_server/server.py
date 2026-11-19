"""MCP server exposing narrowly scoped, read-only employee-data tools.

Run standalone:
    uv run python -m app.mcp_server.server                       # stdio (how the agent uses it)
    uv run python -m app.mcp_server.server --transport streamable-http --port 8765   # for MCP Inspector

Only this process holds PostgreSQL credentials. The agent backend talks to it over MCP and
must present a signed, short-lived identity assertion on every call.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from typing import Literal

from mcp.server.mcpserver import MCPServer
from mcp_types import ToolAnnotations
from pydantic import BaseModel, Field

import os

from app.config import Settings, get_settings
from app.database.connection import LeaveRepository, PostgresLeaveRepository
from app.mcp_server import tools
from app.mcp_server.authorization import Authorizer

LeaveType = Literal["earned", "casual", "sick"]


class LeaveBalanceResult(BaseModel):
    """Tool output. `balances` contains ONLY the requested leave categories."""

    status: Literal["ok", "denied", "not_found", "unavailable", "invalid_input"]
    message: str | None = None
    employee_id: str | None = None
    balances: dict[str, float] | None = None
    unit: str | None = None
    as_of: str | None = None
    source: str | None = None


READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)


def build_server(repo: LeaveRepository, authorizer: Authorizer) -> MCPServer:
    server = MCPServer(
        name="hr-helpdesk-employee-data",
        version="1.0.0",
        instructions="Read-only access to the signed-in employee's synthetic leave balance. "
        "Every call requires a signed identity assertion issued by the helpdesk backend.",
    )

    @server.tool(
        name="get_my_leave_balance",
        title="Get my leave balance",
        description="Return the remaining leave balance of the employee identified by the signed identity "
        "assertion. There is no employee-id parameter: identity comes only from the verified assertion.",
        annotations=READ_ONLY,
        structured_output=True,
    )
    def get_my_leave_balance(
        identity_assertion: str = Field(description="Signed, short-lived identity assertion from the backend."),
        leave_types: list[LeaveType] | None = Field(default=None, description="Subset of leave categories to return (data minimisation)."),
    ) -> LeaveBalanceResult:
        return LeaveBalanceResult(**tools.get_my_leave_balance(repo, authorizer, identity_assertion, leave_types))

    @server.tool(
        name="get_employee_leave_balance_for_hr",
        title="Get an employee's leave balance (HR only)",
        description="HR-administrator only. Returns one employee's leave balance. The caller's HR role is "
        "verified from the signed assertion before the target id is accepted.",
        annotations=READ_ONLY,
        structured_output=True,
    )
    def get_employee_leave_balance_for_hr(
        identity_assertion: str = Field(description="Signed, short-lived identity assertion from the backend."),
        target_employee_id: str = Field(description="Employee id such as E103.", pattern=r"^E\d{3,6}$"),
        leave_types: list[LeaveType] | None = Field(default=None),
    ) -> LeaveBalanceResult:
        return LeaveBalanceResult(**tools.get_employee_leave_balance_for_hr(repo, authorizer, identity_assertion, target_employee_id, leave_types))

    return server


class _JsonStderr(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = {"level": record.levelname, "logger": record.name, "msg": record.getMessage()}
        for k in ("tool", "request_id", "outcome", "duration_ms", "fields", "error"):
            if hasattr(record, k):
                base[k] = getattr(record, k)
        return json.dumps(base)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()

    handler = logging.StreamHandler(sys.stderr)  # stdout is reserved for the stdio protocol
    handler.setFormatter(_JsonStderr())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)

    # As a child of the agent, use ONLY the filtered environment it was given (never the .env file,
    # which also contains LLM/vector-store keys this process has no business seeing).
    settings = Settings(_env_file=None) if os.environ.get("HELPDESK_MCP_CHILD") == "1" else get_settings()
    server = build_server(PostgresLeaveRepository(settings), Authorizer(settings.mcp_identity_secret.get_secret_value()))
    if args.transport == "stdio":
        server.run("stdio")
    else:
        server.run("streamable-http", host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
