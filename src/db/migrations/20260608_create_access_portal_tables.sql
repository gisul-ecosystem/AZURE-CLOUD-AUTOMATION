CREATE TABLE IF NOT EXISTS access_portal_tokens (
  id UUID PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  customer_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_portal_tokens_request_id
  ON access_portal_tokens (request_id);

CREATE INDEX IF NOT EXISTS idx_access_portal_tokens_customer_email
  ON access_portal_tokens (customer_email);

CREATE TABLE IF NOT EXISTS access_portal_sessions (
  id UUID PRIMARY KEY,
  token_id UUID NOT NULL REFERENCES access_portal_tokens(id) ON DELETE CASCADE,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  customer_email TEXT NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_portal_sessions_request_id
  ON access_portal_sessions (request_id);

CREATE TABLE IF NOT EXISTS access_portal_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
  customer_email TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE azure_users
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
