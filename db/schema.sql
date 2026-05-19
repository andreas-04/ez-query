-- Workforce Management System — PostgreSQL schema
-- Run once against a fresh database: psql $DATABASE_URL -f db/schema.sql

-- ---------------------------------------------------------------------------
-- Employees (identity service source of truth)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    email       TEXT        UNIQUE NOT NULL,
    department  TEXT        NOT NULL DEFAULT '',
    -- 0=UNSPECIFIED 1=OFFICE 2=FIELD 3=MIXED  (workforce.common.v1.WorkerType)
    worker_type INT         NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Payroll
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_runs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    period_start    DATE        NOT NULL,
    period_end      DATE        NOT NULL,
    gross_amount    BIGINT      NOT NULL DEFAULT 0,   -- cents
    gross_currency  TEXT        NOT NULL DEFAULT 'USD',
    net_amount      BIGINT      NOT NULL DEFAULT 0,   -- cents
    net_currency    TEXT        NOT NULL DEFAULT 'USD',
    -- e.g. 'pending' | 'processed' | 'paid'
    status          TEXT        NOT NULL DEFAULT 'pending',
    paid_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pay_runs_employee_id_idx ON pay_runs(employee_id);

CREATE TABLE IF NOT EXISTS pay_schedules (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     UUID        UNIQUE NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    -- 0=UNSPECIFIED 1=WEEKLY 2=BIWEEKLY 3=MONTHLY  (workforce.common.v1.PayFrequency)
    frequency       INT         NOT NULL DEFAULT 0,
    effective_date  DATE        NOT NULL,
    next_pay_date   DATE        NOT NULL
);

-- ---------------------------------------------------------------------------
-- Scheduling (office / non-field shifts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shifts (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    start_time  TIMESTAMPTZ NOT NULL,
    end_time    TIMESTAMPTZ NOT NULL,
    -- 0=UNSPECIFIED 1=SCHEDULED 2=COMPLETED 3=MISSED 4=CANCELLED (ShiftStatus)
    status      INT         NOT NULL DEFAULT 1,
    notes       TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shifts_employee_id_idx ON shifts(employee_id);

CREATE TABLE IF NOT EXISTS time_off_requests (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    start_date  DATE        NOT NULL,
    end_date    DATE        NOT NULL,
    reason      TEXT        NOT NULL DEFAULT '',
    approved    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tor_employee_id_idx ON time_off_requests(employee_id);

-- ---------------------------------------------------------------------------
-- Jobs (field work)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT        NOT NULL,
    description     TEXT        NOT NULL DEFAULT '',
    -- 0=UNSPECIFIED 1=SCHEDULED 2=IN_PROGRESS 3=COMPLETE 4=CANCELLED (JobStatus)
    status          INT         NOT NULL DEFAULT 1,
    loc_line1       TEXT        NOT NULL DEFAULT '',
    loc_line2       TEXT        NOT NULL DEFAULT '',
    loc_city        TEXT        NOT NULL DEFAULT '',
    loc_state       TEXT        NOT NULL DEFAULT '',
    loc_postcode    TEXT        NOT NULL DEFAULT '',
    loc_country     TEXT        NOT NULL DEFAULT '',
    scheduled_start TIMESTAMPTZ NOT NULL,
    scheduled_end   TIMESTAMPTZ NOT NULL,
    actual_start    TIMESTAMPTZ,
    actual_end      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_city_idx   ON jobs(loc_city);

-- Many-to-many: employees assigned to jobs.
CREATE TABLE IF NOT EXISTS job_employees (
    job_id      UUID NOT NULL REFERENCES jobs(id)      ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    PRIMARY KEY (job_id, employee_id)
);

CREATE INDEX IF NOT EXISTS job_employees_employee_idx ON job_employees(employee_id);

-- Optional GPS coordinates per job site.
CREATE TABLE IF NOT EXISTS job_locations (
    job_id UUID           PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    lat    DOUBLE PRECISION NOT NULL DEFAULT 0,
    lng    DOUBLE PRECISION NOT NULL DEFAULT 0
);
