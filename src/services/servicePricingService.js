const db = require('../db/postgres');

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

const normalizeLocation = (location) => {
  if (typeof location === 'string' && location.trim().length > 0) {
    return location.trim().toLowerCase();
  }

  return DEFAULT_LOCATION;
};

const getCacheEntry = (location) => {
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

const setCacheEntry = (location, value) => {
  const cacheKey = normalizeLocation(location);
  pricingCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
};

const getServicesWithPricing = async (location) => {
  const resolvedLocation = normalizeLocation(location);
  const cachedServices = getCacheEntry(resolvedLocation);

  logServicePricingEvent('service_pricing_started', {
    location: resolvedLocation
  });

  if (cachedServices) {
    logServicePricingEvent('service_pricing_completed', {
      location: resolvedLocation,
      count: cachedServices.length,
      cached: true
    });

    return cachedServices;
  }

  try {
    const query = `
      SELECT
        s.id,
        s.name,
        s.category,
        s.azure_role,
        COALESCE(price_row.azure_price, s.price_per_user, 0) AS price,
        COALESCE(price_row.currency, 'USD') AS currency,
        CASE
          WHEN price_row.azure_price IS NOT NULL AND price_row.azure_price > 0 THEN 'azure'
          ELSE 'database'
        END AS pricing_source
      FROM services s
      LEFT JOIN LATERAL (
        SELECT
          MIN(COALESCE(sl.retail_price, 0)) AS azure_price,
          MAX(sl.currency) AS currency
        FROM service_locations sl
        WHERE LOWER(TRIM(sl.service_name)) LIKE '%' || LOWER(TRIM(s.name)) || '%'
          AND (
            LOWER(sl.arm_region_name) = LOWER($1)
            OR LOWER(sl.display_location) = LOWER($1)
          )
      ) price_row ON TRUE
      WHERE s.active = true
      ORDER BY s.name ASC
    `;

    const result = await db.query(query, [resolvedLocation]);

    const services = result.rows.map((service) => ({
      id: service.id,
      name: service.name,
      category: service.category,
      azure_role: service.azure_role,
      price: Number(service.price || 0),
      currency: service.currency || 'USD',
      pricingSource: service.pricing_source || 'database'
    }));

    setCacheEntry(resolvedLocation, services);

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
  getServicesWithPricing
};
