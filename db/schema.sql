-- Workforce Management System — PostgreSQL schema
-- Run once against a fresh database: psql $DATABASE_URL -f db/schema.sql

-- ---------------------------------------------------------------------------
-- Tenants (one row per customer organisation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT        NOT NULL,
    -- URL-safe identifier for future subdomain routing.
    slug         TEXT        UNIQUE NOT NULL,
    -- Clerk Organisation ID mapped from the JWT `org_id` claim.
    -- Use 'dev_bypass' for the local development seed tenant.
    clerk_org_id TEXT        UNIQUE NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Employees (identity service source of truth)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    email       TEXT        NOT NULL,
    department  TEXT        NOT NULL DEFAULT '',
    -- 0=UNSPECIFIED 1=OFFICE 2=FIELD 3=MIXED  (workforce.common.v1.WorkerType)
    worker_type INT         NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS employees_tenant_email_uidx ON employees(tenant_id, email);
CREATE        INDEX IF NOT EXISTS employees_tenant_id_idx     ON employees(tenant_id);

-- ---------------------------------------------------------------------------
-- Payroll
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_runs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS pay_runs_employee_id_idx      ON pay_runs(employee_id);
CREATE INDEX IF NOT EXISTS pay_runs_tenant_employee_idx  ON pay_runs(tenant_id, employee_id);

CREATE TABLE IF NOT EXISTS pay_schedules (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    -- 0=UNSPECIFIED 1=WEEKLY 2=BIWEEKLY 3=MONTHLY  (workforce.common.v1.PayFrequency)
    frequency       INT         NOT NULL DEFAULT 0,
    effective_date  DATE        NOT NULL,
    next_pay_date   DATE        NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS pay_schedules_tenant_employee_uidx ON pay_schedules(tenant_id, employee_id);

-- ---------------------------------------------------------------------------
-- Scheduling (office / non-field shifts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shifts (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    start_time  TIMESTAMPTZ NOT NULL,
    end_time    TIMESTAMPTZ NOT NULL,
    -- 0=UNSPECIFIED 1=SCHEDULED 2=COMPLETED 3=MISSED 4=CANCELLED (ShiftStatus)
    status      INT         NOT NULL DEFAULT 1,
    notes       TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shifts_employee_id_idx     ON shifts(employee_id);
CREATE INDEX IF NOT EXISTS shifts_tenant_employee_idx ON shifts(tenant_id, employee_id);

CREATE TABLE IF NOT EXISTS time_off_requests (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    start_date  DATE        NOT NULL,
    end_date    DATE        NOT NULL,
    reason      TEXT        NOT NULL DEFAULT '',
    approved    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tor_employee_id_idx     ON time_off_requests(employee_id);
CREATE INDEX IF NOT EXISTS tor_tenant_employee_idx ON time_off_requests(tenant_id, employee_id);

-- ---------------------------------------------------------------------------
-- Jobs (field work)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS jobs_status_idx       ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_city_idx         ON jobs(loc_city);
CREATE INDEX IF NOT EXISTS jobs_tenant_status_idx ON jobs(tenant_id, status);

-- Many-to-many: employees assigned to jobs.
CREATE TABLE IF NOT EXISTS job_employees (
    tenant_id   UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
    job_id      UUID NOT NULL REFERENCES jobs(id)      ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    PRIMARY KEY (job_id, employee_id)
);

CREATE INDEX IF NOT EXISTS job_employees_employee_idx        ON job_employees(employee_id);
CREATE INDEX IF NOT EXISTS job_employees_tenant_job_idx      ON job_employees(tenant_id, job_id);
CREATE INDEX IF NOT EXISTS job_employees_tenant_employee_idx ON job_employees(tenant_id, employee_id);

-- Optional GPS coordinates per job site.
CREATE TABLE IF NOT EXISTS job_locations (
    tenant_id UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    job_id    UUID           PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    lat       DOUBLE PRECISION NOT NULL DEFAULT 0,
    lng       DOUBLE PRECISION NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Pay Rates (predictive payroll engine)
-- Stores hourly rates per employee used to calculate real-time pay previews.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_rates (
    id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id              UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    currency_code            TEXT          NOT NULL DEFAULT 'USD',
    -- Hourly rates in cents (e.g. 5000 = $50.00/hr)
    day_rate_cents           BIGINT        NOT NULL DEFAULT 0,   -- weekday 06:00–18:00 UTC
    night_rate_cents         BIGINT        NOT NULL DEFAULT 0,   -- weekday 18:00–06:00 UTC
    weekend_rate_cents       BIGINT        NOT NULL DEFAULT 0,   -- Saturday & Sunday all day
    overtime_rate_cents      BIGINT        NOT NULL DEFAULT 0,   -- weekday hours above threshold
    -- Weekly hours threshold before overtime kicks in (default 40)
    overtime_threshold_hours NUMERIC(5,2)  NOT NULL DEFAULT 40.00,
    updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS pay_rates_tenant_employee_uidx ON pay_rates(tenant_id, employee_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- All tables use the same policy: rows are visible / writable only when
-- app.tenant_id GUC matches the row's tenant_id.
-- The Go interceptor sets: SET LOCAL app.tenant_id = '<uuid>' inside a
-- per-request transaction so the GUC resets automatically on commit/rollback.
-- ---------------------------------------------------------------------------
ALTER TABLE employees         ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees         FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employees
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid);

ALTER TABLE pay_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_runs          FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pay_runs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid);

ALTER TABLE pay_schedules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_schedules     FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pay_schedules
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid);

ALTER TABLE shifts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts             FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shifts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid);

ALTER TABLE time_off_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON time_off_requests
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid);

ALTER TABLE jobs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs              FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON jobs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid);

ALTER TABLE job_employees     ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_employees     FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job_employees
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid);

ALTER TABLE job_locations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_locations     FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job_locations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid);

ALTER TABLE pay_rates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_rates         FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pay_rates
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid);
