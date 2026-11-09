-- Separate the local people CMS from legacy users/chat and project-context generations.
CREATE SCHEMA people_cms;

CREATE TABLE people_cms.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE people_cms.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES people_cms.organizations(id),
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  role text NOT NULL CHECK (role IN ('admin', 'hr', 'accountant', 'user')),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  failed_logins integer NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, id)
);

CREATE TABLE people_cms.sessions (
  token_hash char(64) PRIMARY KEY,
  organization_id uuid NOT NULL,
  account_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, account_id) REFERENCES people_cms.accounts(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX people_sessions_expiry ON people_cms.sessions(expires_at);

CREATE TABLE people_cms.leave_accounts (
  organization_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  entitlement_days integer NOT NULL DEFAULT 0 CHECK (entitlement_days BETWEEN 0 AND 366),
  PRIMARY KEY (organization_id, employee_id, year),
  FOREIGN KEY (organization_id, employee_id) REFERENCES people_cms.accounts(organization_id, id)
);

CREATE TABLE people_cms.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  year integer NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  days integer NOT NULL CHECK (days BETWEEN 1 AND 366),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at timestamptz,
  FOREIGN KEY (organization_id, employee_id, year) REFERENCES people_cms.leave_accounts(organization_id, employee_id, year),
  FOREIGN KEY (organization_id, decided_by) REFERENCES people_cms.accounts(organization_id, id),
  CHECK (end_date >= start_date AND extract(year FROM start_date) = year AND extract(year FROM end_date) = year),
  CHECK (days = end_date - start_date + 1),
  CHECK ((status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
      OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_by <> employee_id AND decided_at IS NOT NULL))
);
CREATE INDEX people_leave_scope ON people_cms.leave_requests(organization_id, employee_id, year, status);

CREATE TABLE people_cms.payroll (
  organization_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 0 AND 1000000000000),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, employee_id, month),
  FOREIGN KEY (organization_id, employee_id) REFERENCES people_cms.accounts(organization_id, id)
);

CREATE TABLE people_cms.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 180),
  audience text NOT NULL CHECK (audience IN ('all', 'hr', 'accountant', 'admin')),
  uploaded_by uuid NOT NULL,
  content_hash char(64) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, uploaded_by) REFERENCES people_cms.accounts(organization_id, id)
);
CREATE TABLE people_cms.document_passages (
  organization_id uuid NOT NULL,
  document_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 40),
  line_start integer NOT NULL CHECK (line_start > 0),
  line_end integer NOT NULL CHECK (line_end >= line_start),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 1200),
  PRIMARY KEY (organization_id, document_id, ordinal),
  FOREIGN KEY (organization_id, document_id) REFERENCES people_cms.documents(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX people_passage_search ON people_cms.document_passages USING gin(to_tsvector('simple', content));

CREATE TABLE people_cms.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  operation text NOT NULL CHECK (length(operation) BETWEEN 1 AND 80),
  target_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, actor_id) REFERENCES people_cms.accounts(organization_id, id)
);
CREATE INDEX people_audit_scope ON people_cms.audit_events(organization_id, id DESC);
