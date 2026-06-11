-- ============================================================
-- FULL AZURE CATALOG SEED — paste into Supabase SQL Editor
-- Maps: Category, Service, Description, RBAC Role, Instance Options
-- Does NOT modify application code
-- ============================================================

-- Optional: add instance-options table (not in original ERD)
CREATE TABLE IF NOT EXISTS public.service_instance_options (
  id          BIGSERIAL PRIMARY KEY,
  service_id  BIGINT NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  option_name TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, option_name)
);

-- Optional: capability flags on services (if missing)
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS supports_instances   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS supports_regions     BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_pricing     BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_usage_limit BOOLEAN DEFAULT false;

-- ============================================================
-- STEP 1: Clear catalog data only
-- ============================================================
DELETE FROM public.service_instance_options;
DELETE FROM public.request_service_roles;
DELETE FROM public.request_services;
DELETE FROM public.service_role_mapping;
DELETE FROM public.service_locations;
DELETE FROM public.services;
DELETE FROM public.service_categories;

-- ============================================================
-- STEP 2: Categories (7)
-- ============================================================
INSERT INTO public.service_categories (name) VALUES
  ('Compute'),
  ('Storage & Databases'),
  ('Networking'),
  ('Security & Identity'),
  ('Integration & Messaging'),
  ('Monitoring & DevOps'),
  ('AI & Machine Learning');

-- ============================================================
-- STEP 3: Services (31)
-- ============================================================
INSERT INTO public.services (
  name, category, azure_role, description, price_per_user, active,
  enable_role_selection, default_role, role_required,
  supports_instances, supports_regions, supports_pricing, supports_usage_limit
) VALUES
-- Compute
('Azure Virtual Machines (VMs)', 'Compute', 'Virtual Machine Contributor', 'IaaS for Windows/Linux workloads', 0.10, true, true, 'Virtual Machine Contributor', false, true, true, true, true),
('Azure Kubernetes Service (AKS)', 'Compute', 'Azure Kubernetes Service Cluster Admin Role', 'Managed Kubernetes', 0.00, true, true, 'Azure Kubernetes Service Cluster Admin Role', false, true, true, true, true),
('Azure App Service', 'Compute', 'Website Contributor', 'Web apps and APIs hosting', 0.05, true, true, 'Website Contributor', false, true, true, true, true),
('Azure Functions', 'Compute', 'Contributor', 'Serverless compute', 0.00, true, true, 'Contributor', false, true, true, true, true),

-- Storage & Databases
('Azure Blob Storage', 'Storage & Databases', 'Storage Blob Data Contributor', 'Object storage', 0.02, true, true, 'Storage Blob Data Contributor', false, true, true, true, true),
('Azure SQL Database', 'Storage & Databases', 'SQL DB Contributor', 'Managed SQL database', 0.15, true, true, 'SQL DB Contributor', false, true, true, true, true),
('Azure Cosmos DB', 'Storage & Databases', 'Cosmos DB Operator', 'Globally distributed NoSQL', 0.25, true, true, 'Cosmos DB Operator', false, true, true, true, true),
('Azure Data Lake Storage', 'Storage & Databases', 'Storage Blob Data Contributor', 'Big data analytics storage', 0.03, true, true, 'Storage Blob Data Contributor', false, true, true, true, true),

-- Networking
('Azure Virtual Network (VNet)', 'Networking', 'Network Contributor', 'Private networking', 0.00, true, true, 'Network Contributor', false, true, true, true, false),
('Azure CDN', 'Networking', 'CDN Endpoint Contributor', 'Content delivery', 0.08, true, true, 'CDN Endpoint Contributor', false, true, true, true, true),
('Azure Load Balancer', 'Networking', 'Network Contributor', 'Traffic distribution', 0.03, true, true, 'Network Contributor', false, true, true, true, false),
('Azure Application Gateway', 'Networking', 'Application Gateway Contributor', 'Layer 7 load balancer + WAF', 0.18, true, true, 'Application Gateway Contributor', false, true, true, true, false),
('Azure ExpressRoute', 'Networking', 'Network Contributor', 'Private connectivity', 1.50, true, true, 'Network Contributor', false, true, true, true, false),

-- Security & Identity
('Microsoft Entra ID (Azure AD)', 'Security & Identity', 'User Administrator', 'Identity and access management', 0.00, true, true, 'User Administrator', false, false, false, true, true),
('Azure Key Vault', 'Security & Identity', 'Key Vault Secrets Officer', 'Secrets and certificates', 0.03, true, true, 'Key Vault Secrets Officer', false, true, true, true, true),
('Microsoft Defender for Cloud', 'Security & Identity', 'Security Admin', 'Threat protection', 0.15, true, true, 'Security Admin', false, true, true, true, false),

-- Integration & Messaging
('Azure Service Bus', 'Integration & Messaging', 'Azure Service Bus Data Owner', 'Enterprise messaging', 0.05, true, true, 'Azure Service Bus Data Owner', false, true, true, true, true),
('Azure Event Grid', 'Integration & Messaging', 'EventGrid Contributor', 'Event routing', 0.00, true, true, 'EventGrid Contributor', false, true, true, true, true),
('Azure Logic Apps', 'Integration & Messaging', 'Logic App Contributor', 'Workflow automation', 0.08, true, true, 'Logic App Contributor', false, true, true, true, true),

-- Monitoring & DevOps
('Azure Monitor', 'Monitoring & DevOps', 'Monitoring Contributor', 'Metrics and monitoring', 0.00, true, true, 'Monitoring Contributor', false, true, true, true, false),
('Application Insights', 'Monitoring & DevOps', 'Monitoring Contributor', 'Application performance monitoring', 0.00, true, true, 'Monitoring Contributor', false, true, true, true, true),
('Azure DevOps', 'Monitoring & DevOps', 'Project Administrator', 'CI/CD and repositories', 0.00, true, true, 'Project Administrator', false, false, false, true, true),

-- AI & Machine Learning
('Azure OpenAI Service', 'AI & Machine Learning', 'Cognitive Services OpenAI Contributor', 'GPT models and generative AI', 0.20, true, true, 'Cognitive Services OpenAI Contributor', false, true, true, true, true),
('Azure AI Foundry', 'AI & Machine Learning', 'Azure AI Developer', 'Build and manage AI solutions', 0.15, true, true, 'Azure AI Developer', false, true, true, true, true),
('Azure AI Search', 'AI & Machine Learning', 'Search Service Contributor', 'Vector and enterprise search', 0.12, true, true, 'Search Service Contributor', false, true, true, true, true),
('Azure Machine Learning', 'AI & Machine Learning', 'AzureML Data Scientist', 'ML model training and deployment', 0.18, true, true, 'AzureML Data Scientist', false, true, true, true, true),
('Azure AI Vision', 'AI & Machine Learning', 'Cognitive Services Contributor', 'Image analysis and OCR', 0.05, true, true, 'Cognitive Services Contributor', false, true, true, true, true),
('Azure AI Language', 'AI & Machine Learning', 'Cognitive Services Contributor', 'Text analytics and NLP', 0.05, true, true, 'Cognitive Services Contributor', false, true, true, true, true),
('Azure AI Speech', 'AI & Machine Learning', 'Cognitive Services Contributor', 'Speech-to-text and text-to-speech', 0.05, true, true, 'Cognitive Services Contributor', false, true, true, true, true),
('Azure Bot Service', 'AI & Machine Learning', 'Contributor', 'Conversational AI bots', 0.08, true, true, 'Contributor', false, true, true, true, true),
('Azure AI Document Intelligence', 'AI & Machine Learning', 'Cognitive Services Contributor', 'Document processing and OCR', 0.06, true, true, 'Cognitive Services Contributor', false, true, true, true, true);

-- Link category_id if column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'category_id'
  ) THEN
    UPDATE public.services s
    SET category_id = sc.id
    FROM public.service_categories sc
    WHERE s.category = sc.name;
  END IF;
END $$;

-- ============================================================
-- STEP 4: RBAC role mapping (suggested role + common alternates)
-- ============================================================
INSERT INTO public.service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT s.id, r.azure_role, 'builtin', 'resource_group', r.azure_role = s.default_role, NOW()
FROM public.services s
JOIN (
  VALUES
    -- Compute
    ('Azure Virtual Machines (VMs)', 'Virtual Machine Contributor'),
    ('Azure Virtual Machines (VMs)', 'Virtual Machine User Login'),
    ('Azure Virtual Machines (VMs)', 'Virtual Machine Administrator Login'),
    ('Azure Kubernetes Service (AKS)', 'Azure Kubernetes Service Cluster Admin Role'),
    ('Azure Kubernetes Service (AKS)', 'Azure Kubernetes Service Cluster User Role'),
    ('Azure App Service', 'Website Contributor'),
    ('Azure App Service', 'Contributor'),
    ('Azure Functions', 'Contributor'),
    ('Azure Functions', 'Website Contributor'),

    -- Storage & Databases
    ('Azure Blob Storage', 'Storage Blob Data Contributor'),
    ('Azure Blob Storage', 'Storage Blob Data Reader'),
    ('Azure Blob Storage', 'Storage Blob Data Owner'),
    ('Azure SQL Database', 'SQL DB Contributor'),
    ('Azure Cosmos DB', 'Cosmos DB Operator'),
    ('Azure Cosmos DB', 'Cosmos DB Account Reader Role'),
    ('Azure Data Lake Storage', 'Storage Blob Data Contributor'),

    -- Networking
    ('Azure Virtual Network (VNet)', 'Network Contributor'),
    ('Azure Virtual Network (VNet)', 'Network Reader'),
    ('Azure CDN', 'CDN Endpoint Contributor'),
    ('Azure Load Balancer', 'Network Contributor'),
    ('Azure Application Gateway', 'Application Gateway Contributor'),
    ('Azure ExpressRoute', 'Network Contributor'),

    -- Security & Identity
    ('Microsoft Entra ID (Azure AD)', 'User Administrator'),
    ('Microsoft Entra ID (Azure AD)', 'Directory Readers'),
    ('Azure Key Vault', 'Key Vault Secrets Officer'),
    ('Azure Key Vault', 'Key Vault Secrets User'),
    ('Azure Key Vault', 'Key Vault Reader'),
    ('Microsoft Defender for Cloud', 'Security Admin'),
    ('Microsoft Defender for Cloud', 'Security Reader'),

    -- Integration & Messaging
    ('Azure Service Bus', 'Azure Service Bus Data Owner'),
    ('Azure Service Bus', 'Azure Service Bus Data Sender'),
    ('Azure Service Bus', 'Azure Service Bus Data Receiver'),
    ('Azure Event Grid', 'EventGrid Contributor'),
    ('Azure Logic Apps', 'Logic App Contributor'),

    -- Monitoring & DevOps
    ('Azure Monitor', 'Monitoring Contributor'),
    ('Azure Monitor', 'Monitoring Reader'),
    ('Application Insights', 'Monitoring Contributor'),
    ('Application Insights', 'Monitoring Reader'),
    ('Azure DevOps', 'Project Administrator'),
    ('Azure DevOps', 'Contributor'),

    -- AI & Machine Learning
    ('Azure OpenAI Service', 'Cognitive Services OpenAI Contributor'),
    ('Azure OpenAI Service', 'Cognitive Services User'),
    ('Azure AI Foundry', 'Azure AI Developer'),
    ('Azure AI Search', 'Search Service Contributor'),
    ('Azure AI Search', 'Search Index Data Contributor'),
    ('Azure Machine Learning', 'AzureML Data Scientist'),
    ('Azure Machine Learning', 'AzureML Compute Operator'),
    ('Azure AI Vision', 'Cognitive Services Contributor'),
    ('Azure AI Vision', 'Cognitive Services User'),
    ('Azure AI Language', 'Cognitive Services Contributor'),
    ('Azure AI Language', 'Cognitive Services User'),
    ('Azure AI Speech', 'Cognitive Services Contributor'),
    ('Azure AI Speech', 'Cognitive Services User'),
    ('Azure Bot Service', 'Contributor'),
    ('Azure AI Document Intelligence', 'Cognitive Services Contributor'),
    ('Azure AI Document Intelligence', 'Cognitive Services User')
) AS r(service_name, azure_role) ON s.name = r.service_name;

-- ============================================================
-- STEP 5: Instance options
-- ============================================================
INSERT INTO public.service_instance_options (service_id, option_name, sort_order)
SELECT s.id, o.option_name, o.sort_order
FROM public.services s
JOIN (
  VALUES
    ('Azure Virtual Machines (VMs)', 'B1s', 1),
    ('Azure Virtual Machines (VMs)', 'B2s', 2),
    ('Azure Virtual Machines (VMs)', 'D2s_v5', 3),
    ('Azure Virtual Machines (VMs)', 'D4s_v5', 4),
    ('Azure Virtual Machines (VMs)', 'D8s_v5', 5),
    ('Azure Virtual Machines (VMs)', 'E2s_v5', 6),
    ('Azure Virtual Machines (VMs)', 'E4s_v5', 7),
    ('Azure Virtual Machines (VMs)', 'E8s_v5', 8),

    ('Azure Kubernetes Service (AKS)', 'Dev Cluster', 1),
    ('Azure Kubernetes Service (AKS)', 'Test Cluster', 2),
    ('Azure Kubernetes Service (AKS)', 'Production Cluster', 3),

    ('Azure App Service', 'Free F1', 1),
    ('Azure App Service', 'Basic B1', 2),
    ('Azure App Service', 'Basic B2', 3),
    ('Azure App Service', 'Standard S1', 4),
    ('Azure App Service', 'Premium P1v3', 5),

    ('Azure Functions', 'Consumption Plan', 1),
    ('Azure Functions', 'Premium Plan', 2),
    ('Azure Functions', 'Dedicated Plan', 3),

    ('Azure Blob Storage', 'Hot', 1),
    ('Azure Blob Storage', 'Cool', 2),
    ('Azure Blob Storage', 'Archive', 3),

    ('Azure SQL Database', 'Basic', 1),
    ('Azure SQL Database', 'S0', 2),
    ('Azure SQL Database', 'S1', 3),
    ('Azure SQL Database', 'S2', 4),
    ('Azure SQL Database', 'P1', 5),
    ('Azure SQL Database', 'P2', 6),

    ('Azure Cosmos DB', 'Serverless', 1),
    ('Azure Cosmos DB', 'Provisioned Throughput', 2),
    ('Azure Cosmos DB', 'Autoscale', 3),

    ('Azure Data Lake Storage', 'Gen2 Standard', 1),
    ('Azure Data Lake Storage', 'Gen2 Premium', 2),

    ('Azure Virtual Network (VNet)', 'Small VNet', 1),
    ('Azure Virtual Network (VNet)', 'Medium VNet', 2),
    ('Azure Virtual Network (VNet)', 'Large VNet', 3),

    ('Azure CDN', 'Standard Microsoft', 1),
    ('Azure CDN', 'Standard Akamai', 2),
    ('Azure CDN', 'Premium Verizon', 3),

    ('Azure Load Balancer', 'Basic', 1),
    ('Azure Load Balancer', 'Standard', 2),

    ('Azure Application Gateway', 'Standard_v2', 1),
    ('Azure Application Gateway', 'WAF_v2', 2),

    ('Azure ExpressRoute', '50 Mbps', 1),
    ('Azure ExpressRoute', '100 Mbps', 2),
    ('Azure ExpressRoute', '500 Mbps', 3),
    ('Azure ExpressRoute', '1 Gbps', 4),

    ('Microsoft Entra ID (Azure AD)', 'Free', 1),
    ('Microsoft Entra ID (Azure AD)', 'P1', 2),
    ('Microsoft Entra ID (Azure AD)', 'P2', 3),

    ('Azure Key Vault', 'Standard Vault', 1),
    ('Azure Key Vault', 'Premium Vault', 2),

    ('Microsoft Defender for Cloud', 'Foundational CSPM', 1),
    ('Microsoft Defender for Cloud', 'Defender Servers', 2),
    ('Microsoft Defender for Cloud', 'Defender SQL', 3),

    ('Azure Service Bus', 'Basic', 1),
    ('Azure Service Bus', 'Standard', 2),
    ('Azure Service Bus', 'Premium', 3),

    ('Azure Event Grid', 'Basic', 1),
    ('Azure Event Grid', 'Standard', 2),

    ('Azure Logic Apps', 'Consumption', 1),
    ('Azure Logic Apps', 'Standard', 2),

    ('Azure Monitor', 'Basic Monitoring', 1),
    ('Azure Monitor', 'Advanced Monitoring', 2),

    ('Application Insights', 'Basic', 1),
    ('Application Insights', 'Enterprise', 2),

    ('Azure DevOps', 'Basic', 1),
    ('Azure DevOps', 'Basic + Test Plans', 2),
    ('Azure DevOps', 'Stakeholder', 3),

    ('Azure OpenAI Service', 'GPT-4o', 1),
    ('Azure OpenAI Service', 'GPT-4.1', 2),
    ('Azure OpenAI Service', 'GPT-4 Turbo', 3),
    ('Azure OpenAI Service', 'Embeddings', 4),

    ('Azure AI Foundry', 'Starter', 1),
    ('Azure AI Foundry', 'Standard', 2),
    ('Azure AI Foundry', 'Enterprise', 3),

    ('Azure AI Search', 'Basic', 1),
    ('Azure AI Search', 'Standard S1', 2),
    ('Azure AI Search', 'Standard S2', 3),

    ('Azure Machine Learning', 'Basic Compute', 1),
    ('Azure Machine Learning', 'CPU Cluster', 2),
    ('Azure Machine Learning', 'GPU Cluster', 3),

    ('Azure AI Vision', 'Free', 1),
    ('Azure AI Vision', 'Standard', 2),

    ('Azure AI Language', 'Free', 1),
    ('Azure AI Language', 'Standard', 2),

    ('Azure AI Speech', 'Free', 1),
    ('Azure AI Speech', 'Standard', 2),

    ('Azure Bot Service', 'Basic', 1),
    ('Azure Bot Service', 'Standard', 2),

    ('Azure AI Document Intelligence', 'Free', 1),
    ('Azure AI Document Intelligence', 'Standard', 2)
) AS o(service_name, option_name, sort_order) ON s.name = o.service_name;

-- ============================================================
-- STEP 6: Seed regions (eastus, westus, centralindia, southeastasia)
-- ============================================================
ALTER TABLE public.service_locations
  ADD COLUMN IF NOT EXISTS location TEXT;

INSERT INTO public.service_locations (
  service_name, service_family, arm_region_name, display_location, location,
  currency, retail_price, unit_of_measure, effective_start_date, pricing_source, created_at
)
SELECT
  s.name,
  s.category,
  r.arm_region_name,
  r.display_location,
  r.location,
  'USD',
  COALESCE(s.price_per_user, 0),
  '1 Hour',
  NOW(),
  'seed',
  NOW()
FROM public.services s
CROSS JOIN (
  VALUES
    ('eastus', 'US East', 'East US'),
    ('westus', 'US West', 'West US'),
    ('centralindia', 'IN Central', 'Central India'),
    ('southeastasia', 'AP Southeast', 'Southeast Asia')
) AS r(arm_region_name, location, display_location)
WHERE s.active = true;

-- ============================================================
-- VERIFY
-- ============================================================
SELECT 'Categories' AS entity, COUNT(*)::text AS count FROM public.service_categories
UNION ALL SELECT 'Services', COUNT(*)::text FROM public.services
UNION ALL SELECT 'Role mappings', COUNT(*)::text FROM public.service_role_mapping
UNION ALL SELECT 'Instance options', COUNT(*)::text FROM public.service_instance_options
UNION ALL SELECT 'Locations', COUNT(*)::text FROM public.service_locations;

SELECT category, COUNT(*) AS services FROM public.services GROUP BY category ORDER BY category;
