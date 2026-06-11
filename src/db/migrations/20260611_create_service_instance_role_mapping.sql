CREATE TABLE IF NOT EXISTS service_instance_role_mapping (
  id              BIGSERIAL PRIMARY KEY,
  service_id      INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  instance_option TEXT NOT NULL,
  azure_role      TEXT NOT NULL,
  tier_automated  BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, instance_option)
);

CREATE INDEX IF NOT EXISTS idx_service_instance_role_mapping_service
  ON service_instance_role_mapping (service_id);

INSERT INTO service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM services s
CROSS JOIN (VALUES
  ('Serverless',             'Cosmos DB Account Reader Role'),
  ('Provisioned Throughput', 'Cosmos DB Operator'),
  ('Autoscale',              'Cosmos DB Operator')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%Cosmos DB%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET
  azure_role = EXCLUDED.azure_role,
  tier_automated = EXCLUDED.tier_automated;
