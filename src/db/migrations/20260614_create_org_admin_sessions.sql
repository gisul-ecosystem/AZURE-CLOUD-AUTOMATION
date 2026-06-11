-- Organization admin sessions for the platform-wide admin portal

CREATE TABLE IF NOT EXISTS org_admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_admin_sessions_admin_id
  ON org_admin_sessions (admin_id);

CREATE INDEX IF NOT EXISTS idx_org_admin_sessions_expires_at
  ON org_admin_sessions (expires_at);

COMMENT ON TABLE org_admin_sessions IS 'Sessions for the organization-wide admin portal';
