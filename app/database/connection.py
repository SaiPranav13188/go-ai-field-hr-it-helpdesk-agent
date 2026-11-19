"""PostgreSQL access for the MCP server ONLY (the API process never queries the database).

Every query runs in a READ ONLY transaction with a statement timeout, and sets the
transaction-local RLS context (`app.subject_id`, `app.role`) so the database itself refuses
rows the verified identity may not see.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import Protocol

from psycopg import sql
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.config import Settings

log = logging.getLogger(__name__)

# Whitelist: leave type → column. SQL identifiers are only ever built from this mapping.
LEAVE_COLUMNS = {
    "earned": "earned_leave_remaining",
    "casual": "casual_leave_remaining",
    "sick": "sick_leave_remaining",
}


class DatabaseUnavailable(Exception):
    pass


class LeaveRepository(Protocol):
    def get_leave_balance(self, employee_id: str, leave_types: list[str], *, acting_subject: str, acting_role: str) -> dict | None: ...
    def ping(self) -> bool: ...


def _num(v):
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    return v


class PostgresLeaveRepository:
    def __init__(self, settings: Settings):
        self.s = settings
        conninfo = (
            f"host={settings.postgres_host} port={settings.postgres_port} dbname={settings.postgres_db} "
            f"user={settings.postgres_user} sslmode={settings.postgres_sslmode} "
            f"connect_timeout={settings.postgres_connect_timeout} application_name=hr-helpdesk-mcp"
        )
        self.pool = ConnectionPool(
            conninfo,
            kwargs={"password": settings.postgres_password.get_secret_value(), "prepare_threshold": None, "autocommit": False},
            min_size=0,
            max_size=4,
            timeout=settings.postgres_connect_timeout,
            open=False,
        )
        self._opened = False

    def _ensure_open(self):
        if not self._opened:
            self.pool.open(wait=False)
            self._opened = True

    def get_leave_balance(self, employee_id: str, leave_types: list[str], *, acting_subject: str, acting_role: str) -> dict | None:
        cols = [LEAVE_COLUMNS[t] for t in leave_types]  # KeyError impossible: validated upstream
        query = sql.SQL(
            "SELECT lb.employee_id, {cols}, lb.updated_at "
            "FROM helpdesk.leave_balances lb JOIN helpdesk.employees e USING (employee_id) "
            "WHERE lb.employee_id = %s AND e.employment_status = 'active'"
        ).format(cols=sql.SQL(", ").join(sql.SQL("lb.") + sql.Identifier(c) for c in cols))
        self._ensure_open()
        try:
            with self.pool.connection() as conn:
                with conn.transaction():
                    with conn.cursor(row_factory=dict_row) as cur:
                        cur.execute("SET TRANSACTION READ ONLY")
                        cur.execute("SELECT set_config('statement_timeout', %s, true)", (f"{self.s.postgres_statement_timeout_ms}ms",))
                        cur.execute("SELECT set_config('app.subject_id', %s, true), set_config('app.role', %s, true)", (acting_subject, acting_role))
                        cur.execute(query, (employee_id,))
                        row = cur.fetchone()
        except Exception as exc:
            log.error("db_query_failed", extra={"error": type(exc).__name__})
            raise DatabaseUnavailable(type(exc).__name__) from exc
        if row is None:
            return None
        out = {k: _num(v) for k, v in row.items() if k != "updated_at"}
        out["as_of"] = row["updated_at"].isoformat() if row.get("updated_at") else None
        return out

    def ping(self) -> bool:
        self._ensure_open()
        try:
            with self.pool.connection(timeout=self.s.postgres_connect_timeout) as conn:
                conn.execute("SELECT 1")
                conn.rollback()
            return True
        except Exception:
            return False


class InMemoryLeaveRepository:
    """Test double with the same semantics (incl. RLS-like checks). Used only by tests."""

    def __init__(self, rows: dict[str, dict], fail: bool = False):
        self.rows = rows
        self.fail = fail
        self.calls: list[tuple] = []

    def get_leave_balance(self, employee_id, leave_types, *, acting_subject, acting_role):
        self.calls.append((employee_id, tuple(leave_types), acting_subject, acting_role))
        if self.fail:
            raise DatabaseUnavailable("OperationalError")
        if acting_role != "hr_admin" and employee_id != acting_subject:  # mirrors the RLS policy
            return None
        row = self.rows.get(employee_id)
        if not row or row.get("employment_status", "active") != "active":
            return None
        out = {"employee_id": employee_id} | {LEAVE_COLUMNS[t]: row[LEAVE_COLUMNS[t]] for t in leave_types}
        out["as_of"] = "2026-01-01T00:00:00+00:00"
        return out

    def ping(self) -> bool:
        return not self.fail
