const db = require('../db/postgres');
const { getAzureRetailPrice } = require('./azurePricingService');
const azureCatalogSyncService = require('./azureCatalogSyncService');
const { getLocationsForSelectedServices } = require('./azureLocationService');

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LOCATION = process.env.AZURE_PRICING_DEFAULT_REGION || 'eastus';
const pricingCache = new Map();

const logServicePricingEvent = (event, details = {}) => {
  console.log(
    JSON.stringify({
      event,
      service: 'service-pricing',
      timestamp: new Date().toISOString(),
      ...details
    })
  );
};

const logServiceMappingEvent = (event, details = {}) => {
  console.log(
    JSON.stringify({
      event,
      service: 'service-mapping',
      timestamp: new Date().toISOString(),
      ...details
    })
  );
};

const normalizeLocation = (location) => {
  if (typeof location === 'string' && location.trim().length > 0) {
    return location.trim().toLowerCase();
  }

  return DEFAULT_LOCATION;
};

const getCachedPricing = (location) => {
  const cacheKey = normalizeLocation(location);
  const cachedEntry = pricingCache.get(cacheKey);

  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    pricingCache.delete(cacheKey);
    return null;
  }

  return cachedEntry.value;
};

const setCachedPricing = (location, value) => {
  const cacheKey = normalizeLocation(location);
  pricingCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
};

const getActiveServices = async (category, location) => {
  const hasLocationFilter = typeof location === 'string' && location.trim().length > 0;

  if (hasLocationFilter) {
    const normalizedLocation = location.trim().toLowerCase();
    const values = [normalizedLocation];
    let query = `
      SELECT
        COALESCE(s.id, sl.id) AS id,
        sl.id AS catalog_id,
        sl.service_name AS name,
        COALESCE(s.category, sl.service_family) AS category,
        COALESCE(s.azure_role, '') AS azure_role,
        sl.arm_region_name,
        sl.display_location,
        sl.retail_price,
        sl.currency,
        CASE
          WHEN s.id IS NULL THEN false
          ELSE true
        END AS provision_supported
      FROM service_locations sl
      LEFT JOIN services s
        ON LOWER(REPLACE(TRIM(sl.service_name), 'azure ', '')) LIKE '%' || LOWER(REPLACE(TRIM(s.name), 'azure ', '')) || '%'
      WHERE
        LOWER(sl.arm_region_name) = LOWER($1)
        OR LOWER(sl.display_location) = LOWER($1)
    `;

    query += `
      ORDER BY provision_supported DESC, sl.service_name
      LIMIT 200
    `;

    const result = await db.query(query, values);
    const services = result.rows.map((service) => ({
      id: Number(service.id),
      catalogId: Number(service.catalog_id),
      name: service.name,
      service_name: service.name,
      service_family: service.category,
      arm_region_name: service.arm_region_name,
      display_location: service.display_location,
      category: service.category,
      azure_role: service.azure_role || '',
      price: Number(service.retail_price),
      retail_price: Number(service.retail_price),
      currency: service.currency,
      location: service.arm_region_name,
      provision_supported: Boolean(service.provision_supported)
    }));

    const provisionableCount = services.filter((service) => service.provision_supported).length;
    const previewOnlyCount = services.length - provisionableCount;

    logServiceMappingEvent('backend_service_mapping_completed', {
      location: normalizedLocation,
      count: services.length
    });

    console.log(
      JSON.stringify({
        event: services.length > 0 ? 'services_found' : 'services_empty',
        location: normalizedLocation,
        count: services.length,
        timestamp: new Date().toISOString()
      })
    );

    console.log(
      JSON.stringify({
        event: 'services_provisionable',
        location: normalizedLocation,
        count: provisionableCount,
        timestamp: new Date().toISOString()
      })
    );

    console.log(
      JSON.stringify({
        event: 'services_preview_only',
        location: normalizedLocation,
        count: previewOnlyCount,
        timestamp: new Date().toISOString()
      })
    );

    return services;
  }

  const hasCategoryFilter = typeof category === 'string' && category.trim().length > 0;

  const query = hasCategoryFilter
    ? `
      SELECT
        id,
        name,
        category,
        azure_role,
        description,
        price_per_user,
        active,
        COALESCE(enable_role_selection, true) AS enable_role_selection,
        default_role,
        COALESCE(role_required, true) AS role_required
      FROM services
      WHERE active = true
        AND category = $1
      ORDER BY name
    `
    : `
      SELECT
        id,
        name,
        category,
        azure_role,
        description,
        price_per_user,
        active,
        COALESCE(enable_role_selection, true) AS enable_role_selection,
        default_role,
        COALESCE(role_required, true) AS role_required
      FROM services
      WHERE active = true
      ORDER BY name
    `;

  const values = hasCategoryFilter ? [category.trim()] : [];
  const result = await db.query(query, values);

  return result.rows.map((service) => ({
    ...service,
    price_per_user: Number(service.price_per_user),
    active: Boolean(service.active),
    enable_role_selection: Boolean(service.enable_role_selection),
    role_required: Boolean(service.role_required)
  }));
};

const getDistinctLocations = async () => azureCatalogSyncService.getDistinctLocations();

const normalizeServiceName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^azure\s+/, '');

const getServiceBundle = async () => {
  const { loadInstanceRoleMappings } = require('./instanceRoleMappingService');

  const [categoriesResult, servicesResult, rolesResult, regionsResult, catalogResult, instancesResult, instanceRoleMappings] =
    await Promise.all([
    db.query(
      `
        SELECT
          id,
          name
        FROM service_categories
        ORDER BY id
      `
    ),
    db.query(
      `
        SELECT
          id,
          name,
          category,
          azure_role,
          description,
          price_per_user,
          active,
          COALESCE(enable_role_selection, true) AS enable_role_selection,
          default_role,
          COALESCE(role_required, true) AS role_required,
          COALESCE(supports_instances, false) AS supports_instances,
          COALESCE(supports_regions, true) AS supports_regions,
          COALESCE(supports_pricing, true) AS supports_pricing,
          COALESCE(supports_usage_limit, false) AS supports_usage_limit
        FROM services
        WHERE active = true
        ORDER BY category, name
      `
    ),
    db.query(
      `
        SELECT
          id,
          service_id,
          azure_role
        FROM service_role_mapping
        ORDER BY service_id, azure_role
      `
    ),
    db.query(
      `
        SELECT
          arm_region_name,
          MIN(display_location) AS display_location,
          MIN(location) AS location
        FROM service_locations
        GROUP BY arm_region_name
        ORDER BY arm_region_name
      `
    ),
    db.query(
      `
        SELECT
          service_name AS name,
          COALESCE(service_family, 'General') AS category,
          MIN(retail_price) AS price,
          MIN(currency) AS currency,
          COUNT(DISTINCT arm_region_name) AS location_count,
          MIN(pricing_source) AS pricing_source
        FROM service_locations
        WHERE retail_price >= 0
        GROUP BY service_name, service_family
      `
    ),
    db
      .query(
        `
          SELECT
            id,
            service_id,
            option_name,
            sort_order
          FROM service_instance_options
          ORDER BY service_id, sort_order, option_name
        `
      )
      .catch(() => ({ rows: [] })),
    loadInstanceRoleMappings()
  ]);

  const catalogByName = new Map();

  catalogResult.rows.forEach((row) => {
    catalogByName.set(normalizeServiceName(row.name), row);
  });

  const services = servicesResult.rows.map((service) => {
    const catalog = catalogByName.get(normalizeServiceName(service.name));

    return {
      ...service,
      price_per_user: Number(service.price_per_user),
      active: Boolean(service.active),
      enable_role_selection: Boolean(service.enable_role_selection),
      role_required: Boolean(service.role_required),
      supports_instances: Boolean(service.supports_instances),
      supports_regions: Boolean(service.supports_regions),
      supports_pricing: Boolean(service.supports_pricing),
      supports_usage_limit: Boolean(service.supports_usage_limit),
      service_name: service.name,
      service_family: service.category,
      retail_price: catalog ? Number(catalog.price) : Number(service.price_per_user || 0),
      price: catalog ? Number(catalog.price) : Number(service.price_per_user || 0),
      currency: catalog?.currency || 'USD',
      location_count: catalog ? Number(catalog.location_count) : 0,
      pricing_source: catalog?.pricing_source || 'database'
    };
  });

  const roles = rolesResult.rows.map((row) => ({
    id: Number(row.id),
    serviceId: Number(row.service_id),
    azure_role: row.azure_role
  }));

  const regions = regionsResult.rows.map((row) => ({
    arm_region_name: row.arm_region_name,
    display_location: row.display_location || row.arm_region_name,
    location: row.location || row.arm_region_name
  }));

  const { resolveInstanceGuide } = require('../config/instanceCatalog');

  const servicesByIdForGuides = new Map(
    servicesResult.rows.map((service) => [Number(service.id), service])
  );

  const instances = instancesResult.rows.map((row) => {
    const serviceId = Number(row.service_id);
    const optionName = row.option_name;

    return {
      id: Number(row.id),
      serviceId,
      option_name: optionName,
      sort_order: Number(row.sort_order),
      guide: resolveInstanceGuide(servicesByIdForGuides.get(serviceId)?.name, optionName)
    };
  });

  const tierRoleMappings = instanceRoleMappings.map((row) => ({
    serviceId: Number(row.serviceId),
    instanceOption: row.instanceOption,
    azureRole: row.azureRole,
    tierAutomated: Boolean(row.tierAutomated)
  }));

  return {
    categories: categoriesResult.rows,
    services,
    roles,
    regions,
    instances,
    instanceRoleMappings: tierRoleMappings
  };
};

const getServiceCatalog = async () => {
  const query = `
    SELECT
      MIN(id) AS id,
      service_name AS name,
      COALESCE(service_family, 'General') AS category,
      MIN(retail_price) AS price,
      MIN(currency) AS currency,
      COUNT(DISTINCT arm_region_name) AS location_count,
      MIN(pricing_source) AS pricing_source
    FROM service_locations
    WHERE retail_price >= 0
    GROUP BY service_name, service_family
    ORDER BY price ASC, service_name
  `;

  const result = await db.query(query);

  return result.rows;
};

const parseInstanceSelections = (value) => {
  if (!value) {
    return {};
  }

  if (Array.isArray(value)) {
    return value.reduce((accumulator, entry) => {
      const serviceId = Number(entry?.serviceId ?? entry?.service_id);
      const instanceOption = String(entry?.instanceOption ?? entry?.instance_option ?? '').trim();

      if (Number.isInteger(serviceId) && serviceId > 0 && instanceOption) {
        accumulator[serviceId] = instanceOption;
      }

      return accumulator;
    }, {});
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return {};
  }

  return value.split(',').reduce((accumulator, pair) => {
    const [rawServiceId, ...optionParts] = pair.split(':');
    const serviceId = Number(String(rawServiceId || '').trim());
    const instanceOption = optionParts.join(':').trim();

    if (Number.isInteger(serviceId) && serviceId > 0 && instanceOption) {
      accumulator[serviceId] = instanceOption;
    }

    return accumulator;
  }, {});
};

const getAvailableLocations = async (serviceIds, selectedInstances = {}) => {
  const normalizedServiceIds = Array.from(
    new Set(
      (Array.isArray(serviceIds) ? serviceIds : [])
        .map((serviceId) => Number(serviceId))
        .filter((serviceId) => Number.isInteger(serviceId) && serviceId > 0)
    )
  );

  if (normalizedServiceIds.length === 0) {
    return [];
  }

  const { loadPricingContext } = require('./estimatePricingService');
  const { services, instancesByServiceId } = await loadPricingContext(normalizedServiceIds);
  const selectedInstancesByServiceId = parseInstanceSelections(selectedInstances);

  const locations = await getLocationsForSelectedServices(
    services,
    instancesByServiceId,
    selectedInstancesByServiceId
  );

  console.log({
    selectedServiceIds: normalizedServiceIds,
    locationCount: locations.length,
    source: 'azure-subscription-locations-with-retail-pricing'
  });

  return locations;
};

const getAvailableInstances = async (location, serviceIds) => {
  const { getAvailableInstancesForLocation } = require('./instanceAvailabilityService');
  return getAvailableInstancesForLocation(location, serviceIds);
};

const getServiceRoles = async (serviceId) => {
  const resolvedServiceId = Number(serviceId);

  if (!Number.isInteger(resolvedServiceId) || resolvedServiceId <= 0) {
    return [];
  }

  const result = await db.query(
    `
      SELECT
        id,
        azure_role
      FROM service_role_mapping
      WHERE service_id = $1
      ORDER BY azure_role
    `,
    [resolvedServiceId]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    azure_role: row.azure_role
  }));
};

const getActiveServicesWithPricing = async (location) => {
  const resolvedLocation = normalizeLocation(location);
  const cachedPricing = getCachedPricing(resolvedLocation);

  logServicePricingEvent('service_pricing_started', {
    location: resolvedLocation
  });

  if (cachedPricing) {
    logServicePricingEvent('service_pricing_completed', {
      location: resolvedLocation,
      count: cachedPricing.length,
      cached: true
    });

    return cachedPricing;
  }

  try {
    const query = `
      SELECT
        id,
        name,
        category,
        azure_role,
        description,
        price_per_user,
        active,
        COALESCE(enable_role_selection, true) AS enable_role_selection,
        default_role,
        COALESCE(role_required, true) AS role_required
      FROM services
      WHERE active = true
      ORDER BY name
    `;

    const result = await db.query(query);

    const services = await Promise.all(
      result.rows.map(async (service) => {
        const azurePrice = await getAzureRetailPrice(service.name || service.azure_role || service.category, resolvedLocation);
        const price = azurePrice && Number.isFinite(Number(azurePrice.retailPrice))
          ? Number(azurePrice.retailPrice)
          : Number(service.price_per_user || 0);

        return {
          id: service.id,
          name: service.name,
          category: service.category,
          azure_role: service.azure_role,
          description: service.description,
          active: Boolean(service.active),
          enable_role_selection: Boolean(service.enable_role_selection),
          default_role: service.default_role,
          role_required: Boolean(service.role_required),
          price,
          currency: azurePrice?.currency || 'USD',
          pricingSource: azurePrice ? 'azure' : 'database'
        };
      })
    );

    setCachedPricing(resolvedLocation, services);

    logServicePricingEvent('service_pricing_completed', {
      location: resolvedLocation,
      count: services.length,
      cached: false
    });

    return services;
  } catch (error) {
    logServicePricingEvent('service_pricing_failed', {
      location: resolvedLocation,
      message: error?.message
    });
    throw error;
  }
};

module.exports = {
  getActiveServices,
  getServiceBundle,
  getServiceCatalog,
  getAvailableLocations,
  getAvailableInstances,
  getServiceRoles,
  getActiveServicesWithPricing,
  getDistinctLocations
};
