CREATE TABLE IF NOT EXISTS service_role_mapping (
  service_id INTEGER PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
  azure_role TEXT NOT NULL,
  role_definition_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_role_assignments (
  assignment_id TEXT PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  azure_user_id TEXT NOT NULL,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  role_definition_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, azure_user_id, service_id, role_definition_id)
);
