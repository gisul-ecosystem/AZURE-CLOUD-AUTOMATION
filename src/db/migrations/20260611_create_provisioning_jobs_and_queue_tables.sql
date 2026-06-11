CREATE TABLE IF NOT EXISTS provisioning_jobs (
  id BIGSERIAL PRIMARY KEY,
  source_filename TEXT,
  total_users INTEGER NOT NULL DEFAULT 0,
  completed_users INTEGER NOT NULL DEFAULT 0,
  failed_users INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  input_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provisioning_job_items (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES provisioning_jobs(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source_row JSONB NOT NULL,
  azure_user_id TEXT,
  username TEXT,
  user_principal_name TEXT,
  temporary_password TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_status
  ON provisioning_jobs (status);

CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_created_at
  ON provisioning_jobs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provisioning_job_items_job_status
  ON provisioning_job_items (job_id, status, row_number);

ALTER TABLE service_role_mapping
  ADD COLUMN IF NOT EXISTS entra_group_id TEXT,
  ADD COLUMN IF NOT EXISTS assignment_mode TEXT NOT NULL DEFAULT 'rbac';

ALTER TABLE user_role_assignments
  ADD COLUMN IF NOT EXISTS assignment_kind TEXT NOT NULL DEFAULT 'rbac',
  ADD COLUMN IF NOT EXISTS entra_group_id TEXT;

ALTER TABLE credential_delivery
  ADD COLUMN IF NOT EXISTS delivery_channel TEXT NOT NULL DEFAULT 'email';
