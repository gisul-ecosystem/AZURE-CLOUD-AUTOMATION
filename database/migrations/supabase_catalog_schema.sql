-- ============================================================
-- SUPABASE CATALOG SCHEMA ALIGNMENT
-- Run once in Supabase SQL Editor before rebuild_azure_catalog.sql
-- Matches your live ERD (int8 ids, role_type/scope_type/auto_assign)
-- ============================================================

-- ------------------------------------------------------------
-- services — add catalog capability flags used by GET /api/services
-- ------------------------------------------------------------
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS supports_instances   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS supports_regions     BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_pricing     BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_usage_limit BOOLEAN DEFAULT false;

-- Optional: link category name to service_categories (keeps existing varchar too)
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS category_id BIGINT REFERENCES public.service_categories(id);

-- ------------------------------------------------------------
-- service_locations — add location if missing (app uses it as fallback)
-- ------------------------------------------------------------
ALTER TABLE public.service_locations
  ADD COLUMN IF NOT EXISTS location TEXT;

UPDATE public.service_locations
SET location = COALESCE(location, display_location, arm_region_name)
WHERE location IS NULL;

-- ------------------------------------------------------------
-- service_role_mapping — ensure columns from your ERD exist
-- (your DB already has role_type, scope_type, auto_assign)
-- ------------------------------------------------------------
ALTER TABLE public.service_role_mapping
  ADD COLUMN IF NOT EXISTS role_type    TEXT DEFAULT 'builtin',
  ADD COLUMN IF NOT EXISTS scope_type   TEXT DEFAULT 'resource_group',
  ADD COLUMN IF NOT EXISTS auto_assign  BOOLEAN DEFAULT false;

-- If an old role_definition_id column exists from a prior migration, keep it nullable
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'service_role_mapping'
      AND column_name = 'role_definition_id'
  ) THEN
    ALTER TABLE public.service_role_mapping
      ALTER COLUMN role_definition_id DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_role_mapping_service_id
  ON public.service_role_mapping (service_id);

CREATE INDEX IF NOT EXISTS idx_services_category
  ON public.services (category);

CREATE INDEX IF NOT EXISTS idx_service_locations_arm_region_name
  ON public.service_locations (arm_region_name);
