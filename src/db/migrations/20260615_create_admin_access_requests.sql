-- Admin access requests submitted by users who need elevated permissions

CREATE TABLE IF NOT EXISTS admin_access_requests (
  id BIGSERIAL PRIMARY KEY,
  request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
  customer_email TEXT NOT NULL,
  service_id INTEGER NOT NULL REFERENCES services(id),
  service_name TEXT NOT NULL,
  default_role TEXT,
  requested_access TEXT NOT NULL,
  account_count INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_access_requests_status
  ON admin_access_requests (status);

CREATE INDEX IF NOT EXISTS idx_admin_access_requests_request_id
  ON admin_access_requests (request_id);

CREATE INDEX IF NOT EXISTS idx_admin_access_requests_customer_email
  ON admin_access_requests (customer_email);

COMMENT ON TABLE admin_access_requests IS 'User-submitted requests for elevated Azure RBAC permissions';
