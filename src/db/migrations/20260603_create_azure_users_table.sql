CREATE TABLE IF NOT EXISTS azure_users (
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  azure_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  temporary_password TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (request_id, username)
);
