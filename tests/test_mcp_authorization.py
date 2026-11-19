"""MCP server authorization, exercised over the real MCP protocol (in-process transport)."""

import time

import pytest
from mcp import Client

from app.database.connection import InMemoryLeaveRepository
from app.mcp_server.authorization import Authorizer
from app.mcp_server.server import build_server
from app.security.identity import MCP_AUDIENCE, Principal, issue_mcp_assertion, issue_session_token, sign
from tests.conftest import ROWS

SECRET = "unit-secret"


def assertion(sub="E102", role="employee", secret=SECRET):
    return issue_mcp_assertion(Principal(sub, role), secret, "req-1")


class _Session:
    """Wraps an MCP Client; opened lazily inside the test's own task (anyio scopes are task-bound)."""

    def __init__(self):
        self.repo = InMemoryLeaveRepository({k: dict(v) for k, v in ROWS.items()})
        self.server = build_server(self.repo, Authorizer(SECRET))

    async def call_tool(self, name, args):
        async with Client(self.server) as c:
            return await c.call_tool(name, args)

    async def list_tools(self):
        async with Client(self.server) as c:
            return await c.list_tools()


@pytest.fixture
def client():
    return _Session()


async def call(c, tool, **args):
    return (await c.call_tool(tool, args)).structured_content


async def test_tools_are_narrow_and_read_only(client):
    tools = {t.name: t for t in (await client.list_tools()).tools}
    assert set(tools) == {"get_my_leave_balance", "get_employee_leave_balance_for_hr"}
    own = tools["get_my_leave_balance"]
    assert "employee_id" not in own.input_schema["properties"]  # identity is never a parameter
    assert all(t.annotations.read_only_hint for t in tools.values())


async def test_own_balance_returns_only_requested_field(client):
    r = await call(client, "get_my_leave_balance", identity_assertion=assertion(), leave_types=["earned"])
    assert r["status"] == "ok" and r["employee_id"] == "E102" and r["balances"] == {"earned": 8}
    assert "email" not in str(r) and "department" not in str(r)


async def test_identity_comes_only_from_assertion(client):
    r = await call(client, "get_my_leave_balance", identity_assertion=assertion("E103"))
    assert r["employee_id"] == "E103"
    assert client.repo.calls[-1][0] == "E103"


async def test_replayed_assertion_denied(client):
    a = assertion()
    assert (await call(client, "get_my_leave_balance", identity_assertion=a))["status"] == "ok"
    assert (await call(client, "get_my_leave_balance", identity_assertion=a))["status"] == "denied"


@pytest.mark.parametrize("bad", [
    lambda: assertion(secret="wrong-secret"),
    lambda: sign({"sub": "E102", "role": "employee", "aud": MCP_AUDIENCE, "iat": 0, "exp": time.time() - 5, "jti": "x"}, SECRET),
    lambda: issue_session_token("E102", SECRET, 600)[0],  # a browser session token has the wrong audience
    lambda: "garbage",
    lambda: assertion() + "tampered",
])
async def test_invalid_assertions_denied(client, bad):
    r = await call(client, "get_my_leave_balance", identity_assertion=bad())
    assert r["status"] == "denied" and r["balances"] is None
    assert client.repo.calls == []  # DB never touched


async def test_employee_cannot_use_hr_tool(client):
    r = await call(client, "get_employee_leave_balance_for_hr", identity_assertion=assertion(), target_employee_id="E103")
    assert r["status"] == "denied" and client.repo.calls == []


async def test_hr_admin_can_read_one_employee(client):
    r = await call(client, "get_employee_leave_balance_for_hr", identity_assertion=assertion("HR900", "hr_admin"),
                   target_employee_id="E103", leave_types=["sick"])
    assert r["status"] == "ok" and r["balances"] == {"sick": 2}


async def test_unknown_employee_does_not_leak_existence(client):
    a = await call(client, "get_employee_leave_balance_for_hr", identity_assertion=assertion("HR900", "hr_admin"), target_employee_id="E999")
    client.repo.rows["E104"]["employment_status"] = "inactive"
    b = await call(client, "get_employee_leave_balance_for_hr", identity_assertion=assertion("HR900", "hr_admin"), target_employee_id="E104")
    assert a["status"] == b["status"] == "not_found" and a["message"] == b["message"]


async def test_unknown_session_identity_fails_safely(client):
    r = await call(client, "get_my_leave_balance", identity_assertion=assertion("E777"))
    assert r["status"] == "not_found" and r["balances"] is None


async def test_database_failure_reported_without_data(client):
    client.repo.fail = True
    r = await call(client, "get_my_leave_balance", identity_assertion=assertion())
    assert r["status"] == "unavailable" and r["balances"] is None


async def test_input_validation(client):
    res = await client.call_tool("get_my_leave_balance", {"identity_assertion": assertion(), "leave_types": ["salary"]})
    assert res.is_error
    res = await client.call_tool("get_employee_leave_balance_for_hr",
                                 {"identity_assertion": assertion("HR900", "hr_admin"), "target_employee_id": "E1; DROP TABLE x"})
    assert res.is_error
