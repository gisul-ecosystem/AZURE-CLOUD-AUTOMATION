CREATE TABLE IF NOT EXISTS processed_azure_signins (
  signin_id TEXT PRIMARY KEY,
  azure_user_id TEXT NOT NULL,
  request_id INTEGER,
  user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processed_azure_signins_created_at
  ON processed_azure_signins(created_at DESC);

COMMENT ON TABLE processed_azure_signins IS
  'Tracks Azure audit sign-in IDs already handled by the sign-in monitor';
