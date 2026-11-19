"""Tool implementations (transport-independent, unit-testable).

Narrow, purpose-specific, read-only operations — there is deliberately no generic
`run_sql(query)` tool (spec §5).
"""

from __future__ import annotations

import logging
import time

from app.database.connection import LEAVE_COLUMNS, DatabaseUnavailable, LeaveRepository
from app.mcp_server.authorization import AuthorizationError, Authorizer, validate_employee_id, validate_leave_types

log = logging.getLogger("mcp.audit")
SOURCE = "PostgreSQL helpdesk.leave_balances (via MCP)"
NOT_FOUND_MSG = "No accessible leave record was found for this request."


def _audit(tool: str, rid: str, outcome: str, started: float, **extra) -> None:
    # Audit log: tool, request id, outcome, duration — never credentials or full rows.
    log.info("mcp_tool_call", extra={"tool": tool, "request_id": rid, "outcome": outcome,
                                     "duration_ms": round((time.perf_counter() - started) * 1000, 1), **extra})


def _shape(row: dict, leave_types: list[str]) -> dict:
    return {
        "status": "ok",
        "employee_id": row["employee_id"],
        "balances": {t: row[LEAVE_COLUMNS[t]] for t in leave_types},
        "unit": "working days",
        "as_of": row.get("as_of"),
        "source": SOURCE,
    }


def get_my_leave_balance(repo: LeaveRepository, authz: Authorizer, identity_assertion: str, leave_types: list[str] | None) -> dict:
    tool, started, rid = "get_my_leave_balance", time.perf_counter(), ""
    try:
        principal, rid = authz.authenticate(identity_assertion)
        types = validate_leave_types(leave_types)
    except AuthorizationError as exc:
        _audit(tool, rid, "denied", started)
        return {"status": "denied", "message": str(exc)}
    except ValueError as exc:
        _audit(tool, rid, "invalid_input", started)
        return {"status": "invalid_input", "message": str(exc)}
    try:
        # The ONLY employee id used is the one inside the verified assertion.
        row = repo.get_leave_balance(principal.subject_id, types, acting_subject=principal.subject_id, acting_role=principal.role)
    except DatabaseUnavailable:
        _audit(tool, rid, "db_unavailable", started)
        return {"status": "unavailable", "message": "The employee database is temporarily unavailable."}
    if row is None:
        _audit(tool, rid, "not_found", started)
        return {"status": "not_found", "message": NOT_FOUND_MSG}
    _audit(tool, rid, "ok", started, fields=len(types))
    return _shape(row, types)


def get_employee_leave_balance_for_hr(
    repo: LeaveRepository, authz: Authorizer, identity_assertion: str, target_employee_id: str, leave_types: list[str] | None
) -> dict:
    tool, started, rid = "get_employee_leave_balance_for_hr", time.perf_counter(), ""
    try:
        principal, rid = authz.authenticate(identity_assertion)
        authz.require_hr(principal)  # role check BEFORE the target id is even parsed
        target = validate_employee_id(target_employee_id)
        types = validate_leave_types(leave_types)
    except AuthorizationError as exc:
        _audit(tool, rid, "denied", started)
        return {"status": "denied", "message": str(exc)}
    except ValueError as exc:
        _audit(tool, rid, "invalid_input", started)
        return {"status": "invalid_input", "message": str(exc)}
    try:
        row = repo.get_leave_balance(target, types, acting_subject=principal.subject_id, acting_role=principal.role)
    except DatabaseUnavailable:
        _audit(tool, rid, "db_unavailable", started)
        return {"status": "unavailable", "message": "The employee database is temporarily unavailable."}
    if row is None:  # same message whether the id does not exist or is inactive — no enumeration
        _audit(tool, rid, "not_found", started)
        return {"status": "not_found", "message": NOT_FOUND_MSG}
    _audit(tool, rid, "ok", started, fields=len(types))
    return _shape(row, types)
