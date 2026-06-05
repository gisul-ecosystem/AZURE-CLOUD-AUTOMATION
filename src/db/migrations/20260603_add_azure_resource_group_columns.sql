ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS azure_resource_group_id TEXT,
  ADD COLUMN IF NOT EXISTS azure_resource_group_name TEXT;
