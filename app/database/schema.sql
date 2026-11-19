-- Go AI Field HR & IT Helpdesk — synthetic demo schema.
-- All rows are FAKE test data (spec §4). Safe to run repeatedly.
--
-- Security design:
--   * Tables live in a dedicated `helpdesk` schema (not `public`), so Supabase's auto-generated
--     REST/GraphQL APIs do not expose them.
--   * Row Level Security is enabled with NO policies for anon/authenticated → zero access.
--   * The MCP server connects as `helpdesk_readonly`: SELECT only, and RLS restricts it to the
--     row(s) of the identity it sets per transaction (`app.subject_id` / `app.role`).
--     Authorization is therefore enforced twice: in MCP server code AND in the database.

CREATE SCHEMA IF NOT EXISTS helpdesk;

CREATE TABLE IF NOT EXISTS helpdesk.employees (
    employee_id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    department TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    employment_status TEXT NOT NULL
        CHECK (employment_status IN ('active', 'inactive'))
);

CREATE TABLE IF NOT EXISTS helpdesk.leave_balances (
    employee_id TEXT PRIMARY KEY
        REFERENCES helpdesk.employees(employee_id),
    earned_leave_remaining NUMERIC(5, 1) NOT NULL DEFAULT 0,
    casual_leave_remaining NUMERIC(5, 1) NOT NULL DEFAULT 0,
    sick_leave_remaining NUMERIC(5, 1) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (earned_leave_remaining >= 0),
    CHECK (casual_leave_remaining >= 0),
    CHECK (sick_leave_remaining >= 0)
);

ALTER TABLE helpdesk.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.employees FORCE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.leave_balances FORCE ROW LEVEL SECURITY;

-- Seed (synthetic) -------------------------------------------------------------------------
INSERT INTO helpdesk.employees (employee_id, full_name, department, email, employment_status) VALUES
    ('E101', 'Aarav Mehta',  'Engineering',     'aarav.mehta@example.test',  'active'),
    ('E102', 'Priya Sharma', 'Human Resources', 'priya.sharma@example.test', 'active'),
    ('E103', 'Kabir Rao',    'IT Support',      'kabir.rao@example.test',    'active'),
    ('E104', 'Ananya Iyer',  'Finance',         'ananya.iyer@example.test',  'active'),
    ('E105', 'Ishaan Patel', 'Product',         'ishaan.patel@example.test', 'active')
ON CONFLICT (employee_id) DO UPDATE SET
    full_name = EXCLUDED.full_name, department = EXCLUDED.department,
    email = EXCLUDED.email, employment_status = EXCLUDED.employment_status;

INSERT INTO helpdesk.leave_balances (employee_id, earned_leave_remaining, casual_leave_remaining, sick_leave_remaining) VALUES
    ('E101', 12, 4, 3),
    ('E102',  8, 2, 5),
    ('E103', 15, 1, 2),
    ('E104',  5, 3, 1),
    ('E105', 10, 0, 4)
ON CONFLICT (employee_id) DO UPDATE SET
    earned_leave_remaining = EXCLUDED.earned_leave_remaining,
    casual_leave_remaining = EXCLUDED.casual_leave_remaining,
    sick_leave_remaining = EXCLUDED.sick_leave_remaining,
    updated_at = NOW();
