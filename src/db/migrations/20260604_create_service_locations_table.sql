CREATE TABLE IF NOT EXISTS service_locations (
  service_name TEXT NOT NULL,
  service_family TEXT NOT NULL,
  arm_region_name TEXT NOT NULL,
  location TEXT NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  retail_price NUMERIC(18,8),
  unit_of_measure TEXT,
  effective_start_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_name, arm_region_name)
);

CREATE INDEX IF NOT EXISTS idx_service_locations_location
  ON service_locations (location);

CREATE INDEX IF NOT EXISTS idx_service_locations_arm_region_name
  ON service_locations (arm_region_name);
