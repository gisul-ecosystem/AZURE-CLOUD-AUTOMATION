ALTER TABLE service_role_mapping
  ADD COLUMN IF NOT EXISTS id BIGSERIAL;

UPDATE service_role_mapping
SET id = nextval(pg_get_serial_sequence('service_role_mapping', 'id'))
WHERE id IS NULL;

ALTER TABLE service_role_mapping
  DROP CONSTRAINT IF EXISTS service_role_mapping_pkey;

ALTER TABLE service_role_mapping
  ADD CONSTRAINT service_role_mapping_pkey PRIMARY KEY (id);

ALTER TABLE service_role_mapping
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE user_role_assignments
  ADD COLUMN IF NOT EXISTS user_id INTEGER,
  ADD COLUMN IF NOT EXISTS azure_role TEXT,
  ADD COLUMN IF NOT EXISTS assignment_status TEXT,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS request_service_roles (
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  azure_role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (request_id, service_id, azure_role)
);
