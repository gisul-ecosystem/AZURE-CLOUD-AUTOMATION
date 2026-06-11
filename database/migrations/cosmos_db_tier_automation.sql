-- ============================================================
-- COSMOS DB FULL TIER AUTOMATION
-- Policy enforcement + tier → RBAC role mapping
-- Run in Supabase SQL Editor after supabase_instance_provisioning.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.service_instance_role_mapping (
  id              BIGSERIAL PRIMARY KEY,
  service_id      BIGINT NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  instance_option TEXT NOT NULL,
  azure_role      TEXT NOT NULL,
  tier_automated  BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, instance_option)
);

CREATE INDEX IF NOT EXISTS idx_service_instance_role_mapping_service
  ON public.service_instance_role_mapping (service_id);

-- Ensure both Cosmos roles exist in the role picker catalog
INSERT INTO public.service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT s.id, r.azure_role, 'builtin', 'resource_group', false, NOW()
FROM public.services s
CROSS JOIN (VALUES
  ('Cosmos DB Account Reader Role'),
  ('Cosmos DB Operator')
) AS r(azure_role)
WHERE s.name ILIKE '%Cosmos DB%'
  AND NOT EXISTS (
    SELECT 1
    FROM public.service_role_mapping srm
    WHERE srm.service_id = s.id
      AND srm.azure_role = r.azure_role
  );

-- Tier → role mapping (fully automated)
INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
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
