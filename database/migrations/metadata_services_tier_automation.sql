-- ============================================================
-- METADATA SERVICES FULL TIER AUTOMATION
-- Tier → RBAC role mapping for all services without built-in
-- policy rules (Cosmos DB pattern extended to remaining catalog).
-- Run in Supabase SQL Editor after cosmos_db_tier_automation.sql
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

-- Extra roles needed for tier automation (not all were in the seed catalog)
INSERT INTO public.service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT s.id, r.azure_role, 'builtin', 'resource_group', false, NOW()
FROM public.services s
CROSS JOIN (VALUES
  ('Logic App Operator'),
  ('Network Reader')
) AS r(azure_role)
WHERE (
  s.name ILIKE '%Logic Apps%'
  OR s.name ILIKE '%Virtual Network%'
  OR s.name ILIKE '%Load Balancer%'
  OR s.name ILIKE '%ExpressRoute%'
)
AND NOT EXISTS (
  SELECT 1
  FROM public.service_role_mapping srm
  WHERE srm.service_id = s.id
    AND srm.azure_role = r.azure_role
);

-- Helper: upsert tier rows for a service matched by name pattern
-- Networking
INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Small VNet',  'Network Reader'),
  ('Medium VNet', 'Network Contributor'),
  ('Large VNet',  'Network Contributor')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%Virtual Network%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Standard Microsoft', 'CDN Endpoint Contributor'),
  ('Standard Akamai',    'CDN Endpoint Contributor'),
  ('Premium Verizon',    'CDN Endpoint Contributor')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%CDN%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Basic',    'Network Reader'),
  ('Standard', 'Network Contributor')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%Load Balancer%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Standard_v2', 'Application Gateway Contributor'),
  ('WAF_v2',      'Application Gateway Contributor')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%Application Gateway%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('50 Mbps',  'Network Reader'),
  ('100 Mbps', 'Network Reader'),
  ('500 Mbps', 'Network Contributor'),
  ('1 Gbps',   'Network Contributor')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%ExpressRoute%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

-- Security & Identity
INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Free', 'Directory Readers'),
  ('P1',   'User Administrator'),
  ('P2',   'User Administrator')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%Entra ID%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Foundational CSPM', 'Security Reader'),
  ('Defender Servers',  'Security Admin'),
  ('Defender SQL',      'Security Admin')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%Defender for Cloud%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

-- Integration & Messaging
INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Basic',    'EventGrid Contributor'),
  ('Standard', 'EventGrid Contributor')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%Event Grid%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Consumption', 'Logic App Contributor'),
  ('Standard',    'Logic App Operator')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%Logic Apps%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

INSERT INTO public.service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT s.id, 'Logic App Operator', 'builtin', 'resource_group', false, NOW()
FROM public.services s
WHERE s.name ILIKE '%Logic Apps%'
  AND NOT EXISTS (
    SELECT 1 FROM public.service_role_mapping srm
    WHERE srm.service_id = s.id AND srm.azure_role = 'Logic App Operator'
  );

-- Monitoring & DevOps
INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Basic Monitoring',    'Monitoring Reader'),
  ('Advanced Monitoring', 'Monitoring Contributor')
) AS m(instance_option, azure_role)
WHERE s.name = 'Azure Monitor'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Basic',      'Monitoring Reader'),
  ('Enterprise', 'Monitoring Contributor')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%Application Insights%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Stakeholder',          'Contributor'),
  ('Basic',                'Project Administrator'),
  ('Basic + Test Plans',   'Project Administrator')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%Azure DevOps%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

-- AI & Machine Learning
INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Embeddings',   'Cognitive Services User'),
  ('GPT-4o',       'Cognitive Services OpenAI Contributor'),
  ('GPT-4.1',      'Cognitive Services OpenAI Contributor'),
  ('GPT-4 Turbo',  'Cognitive Services OpenAI Contributor')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%OpenAI Service%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Starter',    'Azure AI Developer'),
  ('Standard',   'Azure AI Developer'),
  ('Enterprise', 'Azure AI Developer')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%AI Foundry%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Basic',       'Search Index Data Contributor'),
  ('Standard S1', 'Search Service Contributor'),
  ('Standard S2', 'Search Service Contributor')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%AI Search%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Basic Compute', 'AzureML Compute Operator'),
  ('CPU Cluster',   'AzureML Data Scientist'),
  ('GPU Cluster',   'AzureML Data Scientist')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%Machine Learning%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Free',     'Cognitive Services User'),
  ('Standard', 'Cognitive Services Contributor')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%AI Vision%'
   OR s.name ILIKE '%AI Language%'
   OR s.name ILIKE '%AI Speech%'
   OR s.name ILIKE '%Document Intelligence%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

INSERT INTO public.service_instance_role_mapping (service_id, instance_option, azure_role, tier_automated)
SELECT s.id, m.instance_option, m.azure_role, true
FROM public.services s
CROSS JOIN (VALUES
  ('Basic',    'Contributor'),
  ('Standard', 'Contributor')
) AS m(instance_option, azure_role)
WHERE s.name ILIKE '%Bot Service%'
ON CONFLICT (service_id, instance_option)
DO UPDATE SET azure_role = EXCLUDED.azure_role, tier_automated = EXCLUDED.tier_automated;

-- Enable instance picker for tier-automated metadata services
UPDATE public.services
SET supports_instances = true
WHERE name ILIKE ANY (ARRAY[
  '%Virtual Network%',
  '%CDN%',
  '%Load Balancer%',
  '%Application Gateway%',
  '%ExpressRoute%',
  '%Entra ID%',
  '%Defender for Cloud%',
  '%Event Grid%',
  '%Logic Apps%',
  'Azure Monitor',
  '%Application Insights%',
  '%Azure DevOps%',
  '%OpenAI Service%',
  '%AI Foundry%',
  '%AI Search%',
  '%Machine Learning%',
  '%AI Vision%',
  '%AI Language%',
  '%AI Speech%',
  '%Document Intelligence%',
  '%Bot Service%'
]);
