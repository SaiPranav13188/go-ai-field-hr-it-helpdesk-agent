"""Create the helpdesk schema, seed SYNTHETIC rows, and provision the least-privilege role.

Run once, locally, with an ADMIN connection (e.g. Supabase's `postgres` user). The admin URL
is only used by this script and must never be deployed:

    ADMIN_DATABASE_URL='postgresql://postgres.<ref>:<admin-pw>@<pooler-host>:5432/postgres' \
    uv run python -m scripts.seed_demo_database

The read-only role's password is taken from POSTGRES_PASSWORD in .env (the same value the MCP
server uses to connect as POSTGRES_USER).
"""

from __future__ import annotations

import os
import sys

import psycopg
from psycopg import sql

from app.config import ROOT_DIR, get_settings

ROLE = "helpdesk_readonly"


def main() -> None:
    from dotenv import dotenv_values

    admin_url = os.environ.get("ADMIN_DATABASE_URL") or dotenv_values(ROOT_DIR / ".env").get("ADMIN_DATABASE_URL")
    if not admin_url:
        sys.exit("Set ADMIN_DATABASE_URL (in .env or the environment) — the admin connection string, used only for this one-off setup.")
    settings = get_settings()
    ro_password = settings.postgres_password.get_secret_value()
    if not ro_password or ro_password == "replace_me":
        sys.exit("Set POSTGRES_PASSWORD in .env — it becomes the password of the read-only role.")

    schema_sql = (ROOT_DIR / "app" / "database" / "schema.sql").read_text()
    with psycopg.connect(admin_url, prepare_threshold=None, connect_timeout=10) as conn:
        with conn.cursor() as cur:
            cur.execute(schema_sql)
            cur.execute(
                sql.SQL(
                    """
                    DO $$ BEGIN
                      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = {role_lit}) THEN
                        CREATE ROLE {role} LOGIN;
                      END IF;
                    END $$;
                    """
                ).format(role=sql.Identifier(ROLE), role_lit=sql.Literal(ROLE))
            )
            role = sql.Identifier(ROLE)
            cur.execute(sql.SQL("ALTER ROLE {} WITH LOGIN PASSWORD {}").format(role, sql.Literal(ro_password)))
            cur.execute(sql.SQL("ALTER ROLE {} SET default_transaction_read_only = on").format(role))
            cur.execute(sql.SQL("ALTER ROLE {} SET statement_timeout = '3s'").format(role))
            cur.execute(sql.SQL("REVOKE ALL ON ALL TABLES IN SCHEMA helpdesk FROM {}").format(role))
            cur.execute(sql.SQL("GRANT USAGE ON SCHEMA helpdesk TO {}").format(role))
            # Column-level least privilege: the MCP server never needs names, e-mails or departments.
            cur.execute(sql.SQL("GRANT SELECT (employee_id, employment_status) ON helpdesk.employees TO {}").format(role))
            cur.execute(sql.SQL(
                "GRANT SELECT (employee_id, earned_leave_remaining, casual_leave_remaining, sick_leave_remaining, updated_at) "
                "ON helpdesk.leave_balances TO {}").format(role))
            # Row Level Security: self only, or any row for the hr_admin role.
            predicate = "employee_id = current_setting('app.subject_id', true) OR current_setting('app.role', true) = 'hr_admin'"
            for table in ("employees", "leave_balances"):
                cur.execute(sql.SQL("DROP POLICY IF EXISTS helpdesk_self_or_hr ON helpdesk.{}").format(sql.Identifier(table)))
                cur.execute(sql.SQL("CREATE POLICY helpdesk_self_or_hr ON helpdesk.{} FOR SELECT TO {} USING (" + predicate + ")").format(sql.Identifier(table), role))
            # Make sure Supabase's API roles cannot read the schema.
            for api_role in ("anon", "authenticated"):
                cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (api_role,))
                if cur.fetchone():
                    cur.execute(sql.SQL("REVOKE ALL ON SCHEMA helpdesk FROM {}").format(sql.Identifier(api_role)))
                    cur.execute(sql.SQL("REVOKE ALL ON ALL TABLES IN SCHEMA helpdesk FROM {}").format(sql.Identifier(api_role)))
        conn.commit()

        # A freshly created role is NOSUPERUSER/NOBYPASSRLS by default (Supabase's admin may not set those
        # flags explicitly) — verify instead of assuming.
        with conn.cursor() as cur:
            cur.execute("SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = %s", (ROLE,))
            flags = cur.fetchone()
            if any(flags):
                sys.exit(f"Refusing to continue: {ROLE} has elevated attributes {flags}")

        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM helpdesk.employees")
            n_emp = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM helpdesk.leave_balances")
            n_bal = cur.fetchone()[0]
    print(f"Seeded {n_emp} synthetic employees and {n_bal} leave balances; role '{ROLE}' provisioned (SELECT-only, column grants, RLS).")


if __name__ == "__main__":
    main()
