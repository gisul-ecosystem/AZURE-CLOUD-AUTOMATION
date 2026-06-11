-- ================================================
-- AZURE SERVICE CATALOG REBUILD (Supabase schema)
-- ================================================
-- Prerequisite: run supabase_catalog_schema.sql first
-- Catalog data only — does not touch users, requests, or provisioning tables

-- ================================================
-- STEP 1: Delete existing catalog data
-- ================================================
-- request_services has FK to services — clear junction rows first if rebuilding
DELETE FROM request_service_roles;
DELETE FROM request_services;
DELETE FROM service_role_mapping;
DELETE FROM service_locations;
DELETE FROM services;
DELETE FROM service_categories;

-- ================================================
-- STEP 2: Insert categories
-- ================================================
INSERT INTO service_categories (name)
VALUES
  ('Compute'),
  ('Storage & Databases'),
  ('Networking'),
  ('Security & Identity'),
  ('Integration & Messaging'),
  ('Monitoring & DevOps');

-- ================================================
-- STEP 3: Insert services
-- ================================================

-- COMPUTE
INSERT INTO services (
  name, category, azure_role, description, price_per_user, active,
  enable_role_selection, default_role, role_required,
  supports_instances, supports_regions, supports_pricing, supports_usage_limit
)
VALUES
  ('Azure Virtual Machines', 'Compute', 'Virtual Machine User Login', 'Create Windows and Linux virtual machines in seconds', 0.10, true, true, 'Virtual Machine User Login', false, true, true, true, true),
  ('Azure Kubernetes Service', 'Compute', 'Azure Kubernetes Service Cluster User Role', 'Deploy and scale containers on managed Kubernetes', 0.00, true, true, 'Azure Kubernetes Service Cluster User Role', false, true, true, true, true),
  ('Azure App Service', 'Compute', 'Website Contributor', 'Quickly create powerful cloud apps for web and mobile', 0.05, true, true, 'Website Contributor', false, true, true, true, true),
  ('Azure Functions', 'Compute', 'Website Contributor', 'Process events with serverless code', 0.00, true, true, 'Website Contributor', false, true, true, true, true);

-- STORAGE & DATABASES
INSERT INTO services (
  name, category, azure_role, description, price_per_user, active,
  enable_role_selection, default_role, role_required,
  supports_instances, supports_regions, supports_pricing, supports_usage_limit
)
VALUES
  ('Azure Blob Storage', 'Storage & Databases', 'Storage Blob Data Contributor', 'Massively scalable object storage for any type of unstructured data', 0.02, true, true, 'Storage Blob Data Contributor', false, true, true, true, true),
  ('Azure SQL Database', 'Storage & Databases', 'SQL DB Contributor', 'Managed, intelligent SQL in the cloud', 0.15, true, true, 'SQL DB Contributor', false, true, true, true, true),
  ('Azure Cosmos DB', 'Storage & Databases', 'Cosmos DB Account Reader Role', 'Globally distributed, multi-model database service', 0.25, true, true, 'Cosmos DB Account Reader Role', false, true, true, true, true),
  ('Azure Data Lake Storage', 'Storage & Databases', 'Storage Blob Data Contributor', 'Scalable data lake for high-performance analytics', 0.03, true, true, 'Storage Blob Data Contributor', false, true, true, true, true);

-- NETWORKING
INSERT INTO services (
  name, category, azure_role, description, price_per_user, active,
  enable_role_selection, default_role, role_required,
  supports_instances, supports_regions, supports_pricing, supports_usage_limit
)
VALUES
  ('Azure Virtual Network', 'Networking', 'Network Contributor', 'Provision private networks and connect to on-premises datacenters', 0.00, true, true, 'Network Contributor', false, true, true, true, false),
  ('Azure CDN', 'Networking', 'CDN Endpoint Contributor', 'Ensure secure, reliable content delivery with global reach', 0.08, true, false, 'CDN Endpoint Contributor', true, true, true, true, true),
  ('Azure Application Gateway', 'Networking', 'Contributor', 'Build secure, scalable, highly available web front ends', 0.18, true, false, 'Contributor', true, true, true, true, false),
  ('Azure ExpressRoute', 'Networking', 'Network Contributor', 'Dedicated private network fiber connections to Azure', 1.50, true, false, 'Network Contributor', true, true, true, true, false);

-- SECURITY & IDENTITY
INSERT INTO services (
  name, category, azure_role, description, price_per_user, active,
  enable_role_selection, default_role, role_required,
  supports_instances, supports_regions, supports_pricing, supports_usage_limit
)
VALUES
  ('Microsoft Entra ID', 'Security & Identity', 'Directory Readers', 'Synchronize on-premises directories and enable single sign-on', 0.00, true, true, 'Directory Readers', false, false, false, true, true),
  ('Azure Key Vault', 'Security & Identity', 'Key Vault Secrets User', 'Safeguard and maintain control of keys and secrets', 0.03, true, true, 'Key Vault Secrets User', false, true, true, true, true),
  ('Microsoft Defender for Cloud', 'Security & Identity', 'Security Reader', 'Unified security management and advanced threat protection', 0.15, true, false, 'Security Reader', true, true, true, true, false);

-- INTEGRATION & MESSAGING
INSERT INTO services (
  name, category, azure_role, description, price_per_user, active,
  enable_role_selection, default_role, role_required,
  supports_instances, supports_regions, supports_pricing, supports_usage_limit
)
VALUES
  ('Azure Service Bus', 'Integration & Messaging', 'Azure Service Bus Data Sender', 'Connect across private and public cloud environments', 0.05, true, true, 'Azure Service Bus Data Sender', false, true, true, true, true),
  ('Azure Event Grid', 'Integration & Messaging', 'EventGrid Contributor', 'Reliable event delivery at massive scale', 0.00, true, false, 'EventGrid Contributor', true, true, true, true, true),
  ('Azure Logic Apps', 'Integration & Messaging', 'Logic App Contributor', 'Automate access and use of data across clouds', 0.08, true, false, 'Logic App Contributor', true, true, true, true, true);

-- MONITORING & DEVOPS
INSERT INTO services (
  name, category, azure_role, description, price_per_user, active,
  enable_role_selection, default_role, role_required,
  supports_instances, supports_regions, supports_pricing, supports_usage_limit
)
VALUES
  ('Azure Monitor', 'Monitoring & DevOps', 'Monitoring Reader', 'Full observability into applications, infrastructure, and network', 0.00, true, true, 'Monitoring Reader', false, true, true, true, false),
  ('Azure DevOps', 'Monitoring & DevOps', 'Contributor', 'Services for teams to share code, track work, and ship software', 0.00, true, false, 'Contributor', true, false, false, true, true);

-- Link category_id FK (optional — category varchar kept for app compatibility)
UPDATE services s
SET category_id = sc.id
FROM service_categories sc
WHERE s.category = sc.name;

-- ================================================
-- STEP 4: Populate service_role_mapping
-- Columns: service_id, azure_role, role_type, scope_type, auto_assign
-- ================================================

-- Virtual Machines
INSERT INTO service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT s.id, r.azure_role, 'builtin', 'resource_group', r.azure_role = s.default_role, NOW()
FROM services s
CROSS JOIN (VALUES
  ('Virtual Machine Administrator Login'),
  ('Virtual Machine User Login'),
  ('Virtual Machine Contributor')
) AS r(azure_role)
WHERE s.name = 'Azure Virtual Machines';

-- Blob Storage
INSERT INTO service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT s.id, r.azure_role, 'builtin', 'resource_group', r.azure_role = s.default_role, NOW()
FROM services s
CROSS JOIN (VALUES
  ('Storage Blob Data Contributor'),
  ('Storage Blob Data Reader'),
  ('Storage Blob Data Owner')
) AS r(azure_role)
WHERE s.name = 'Azure Blob Storage';

-- Key Vault
INSERT INTO service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT s.id, r.azure_role, 'builtin', 'resource_group', r.azure_role = s.default_role, NOW()
FROM services s
CROSS JOIN (VALUES
  ('Key Vault Secrets User'),
  ('Key Vault Secrets Officer'),
  ('Key Vault Reader')
) AS r(azure_role)
WHERE s.name = 'Azure Key Vault';

-- Service Bus
INSERT INTO service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT s.id, r.azure_role, 'builtin', 'resource_group', r.azure_role = s.default_role, NOW()
FROM services s
CROSS JOIN (VALUES
  ('Azure Service Bus Data Sender'),
  ('Azure Service Bus Data Receiver')
) AS r(azure_role)
WHERE s.name = 'Azure Service Bus';

-- AKS
INSERT INTO service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT s.id, r.azure_role, 'builtin', 'resource_group', r.azure_role = s.default_role, NOW()
FROM services s
CROSS JOIN (VALUES
  ('Azure Kubernetes Service Cluster User Role'),
  ('Azure Kubernetes Service Cluster Admin Role')
) AS r(azure_role)
WHERE s.name = 'Azure Kubernetes Service';

-- App Service / Functions
INSERT INTO service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT s.id, 'Website Contributor', 'builtin', 'resource_group', s.default_role = 'Website Contributor', NOW()
FROM services s
WHERE s.name IN ('Azure App Service', 'Azure Functions');

-- SQL Database
INSERT INTO service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT id, 'SQL DB Contributor', 'builtin', 'resource_group', true, NOW()
FROM services WHERE name = 'Azure SQL Database';

-- Cosmos DB
INSERT INTO service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT id, 'Cosmos DB Account Reader Role', 'builtin', 'resource_group', true, NOW()
FROM services WHERE name = 'Azure Cosmos DB';

-- Data Lake Storage
INSERT INTO service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT id, 'Storage Blob Data Contributor', 'builtin', 'resource_group', true, NOW()
FROM services WHERE name = 'Azure Data Lake Storage';

-- Virtual Network
INSERT INTO service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT s.id, r.azure_role, 'builtin', 'resource_group', r.azure_role = s.default_role, NOW()
FROM services s
CROSS JOIN (VALUES
  ('Network Contributor'),
  ('Network Reader')
) AS r(azure_role)
WHERE s.name = 'Azure Virtual Network';

-- Entra ID
INSERT INTO service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT id, 'Directory Readers', 'builtin', 'resource_group', true, NOW()
FROM services WHERE name = 'Microsoft Entra ID';

-- Azure Monitor
INSERT INTO service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT s.id, r.azure_role, 'builtin', 'resource_group', r.azure_role = s.default_role, NOW()
FROM services s
CROSS JOIN (VALUES
  ('Monitoring Reader'),
  ('Monitoring Contributor')
) AS r(azure_role)
WHERE s.name = 'Azure Monitor';

-- Auto-assigned roles for services without role selection
INSERT INTO service_role_mapping (service_id, azure_role, role_type, scope_type, auto_assign, created_at)
SELECT id, default_role, 'builtin', 'resource_group', true, NOW()
FROM services
WHERE enable_role_selection = false
  AND default_role IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM service_role_mapping srm
    WHERE srm.service_id = services.id
      AND srm.azure_role = services.default_role
  );

-- ================================================
-- STEP 5: Seed service_locations
-- ================================================
-- Matches your ERD: no updated_at, location optional

INSERT INTO service_locations (
  service_name,
  service_family,
  arm_region_name,
  display_location,
  location,
  currency,
  retail_price,
  unit_of_measure,
  effective_start_date,
  pricing_source,
  created_at
)
SELECT
  s.name,
  s.category,
  region.arm_region_name,
  region.display_location,
  region.location,
  'USD',
  COALESCE(s.price_per_user, 0),
  '1 Hour',
  NOW(),
  'seed',
  NOW()
FROM services s
CROSS JOIN (
  VALUES
    ('eastus', 'US East', 'East US'),
    ('westus', 'US West', 'West US'),
    ('centralindia', 'IN Central', 'Central India'),
    ('southeastasia', 'AP Southeast', 'Southeast Asia')
) AS region(arm_region_name, location, display_location)
WHERE s.active = true;

-- ================================================
-- VERIFICATION
-- ================================================
SELECT 'Categories' AS entity, COUNT(*) AS count FROM service_categories
UNION ALL
SELECT 'Services', COUNT(*) FROM services
UNION ALL
SELECT 'Role Mappings', COUNT(*) FROM service_role_mapping
UNION ALL
SELECT 'Service Locations', COUNT(*) FROM service_locations;
