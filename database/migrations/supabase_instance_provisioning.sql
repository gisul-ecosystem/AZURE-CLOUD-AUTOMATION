-- ============================================================
-- INSTANCE SELECTION + AZURE RESOURCE PROVISIONING TABLES
-- Run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.service_instance_options (
  id          BIGSERIAL PRIMARY KEY,
  service_id  BIGINT NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  option_name TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, option_name)
);

CREATE TABLE IF NOT EXISTS public.request_service_instances (
  id              BIGSERIAL PRIMARY KEY,
  request_id      BIGINT NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  service_id      BIGINT NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  instance_option TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, service_id)
);

CREATE TABLE IF NOT EXISTS public.provisioned_service_resources (
  id                BIGSERIAL PRIMARY KEY,
  request_id        BIGINT NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  service_id        BIGINT NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  instance_option   TEXT NOT NULL,
  resource_type     TEXT NOT NULL,
  resource_name     TEXT NOT NULL,
  azure_resource_id TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_request_service_instances_request
  ON public.request_service_instances (request_id);

CREATE INDEX IF NOT EXISTS idx_provisioned_service_resources_request
  ON public.provisioned_service_resources (request_id);

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS supports_instances BOOLEAN DEFAULT false;
