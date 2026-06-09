const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const { parseFlexibleDateTime } = require('../utils/dateTime');

const DEFAULT_LOCATION = process.env.AZURE_PRICING_DEFAULT_REGION || 'eastus';
const AZURE_RETAIL_API_BASE = 'https://prices.azure.com/api/retail/prices';

const logPricingEvent = (event, details = {}) => {
  console.log(
    JSON.stringify({
      event,
      service: 'pricing',
      timestamp: new Date().toISOString(),
      ...details
    })
  );
};

const escapeAzureFilterValue = (value) => String(value || '').trim().replace(/'/g, "''");

const fetchAzureRetailItems = async (serviceName, location) => {
  const safeServiceName = escapeAzureFilterValue(serviceName);
  const safeLocation = escapeAzureFilterValue(location);

  if (!safeServiceName || !safeLocation) {
    return [];
  }

  const filter = `serviceName eq '${safeServiceName}' and armRegionName eq '${safeLocation}' and priceType eq 'Consumption'`;
  let nextUrl = `${AZURE_RETAIL_API_BASE}?$filter=${encodeURIComponent(filter)}`;
  const items = [];

  while (nextUrl) {
    const response = await fetch(nextUrl);

    if (!response.ok) {
      throw new AppError(`Azure Retail Pricing API request failed with status ${response.status}.`, 502);
    }

    const data = await response.json();
    if (Array.isArray(data?.Items)) {
      items.push(...data.Items);
    }

    nextUrl = data?.NextPageLink || data?.nextPageLink || '';
  }

  return items;
};

const resolvePricingArgs = (payload = {}) => {
  const startDate =
    typeof payload.startDate === 'string' && payload.startDate.trim().length > 0
      ? payload.startDate.trim()
      : new Date().toISOString().slice(0, 10);
  const endDate =
    typeof payload.endDate === 'string' && payload.endDate.trim().length > 0
      ? payload.endDate.trim()
      : (() => {
          const date = new Date();
          date.setUTCDate(date.getUTCDate() + 30);
          return date.toISOString().slice(0, 10);
        })();
  const location =
    typeof payload.location === 'string' && payload.location.trim().length > 0
      ? payload.location.trim()
      : DEFAULT_LOCATION;
  const client = payload.client && typeof payload.client.query === 'function' ? payload.client : db;

  return {
    accountCount: Number(payload.accountCount || 0),
    serviceIds: Array.isArray(payload.serviceIds) ? payload.serviceIds : [],
    location,
    startDate,
    endDate,
    client
  };
};

const calculatePricing = async ({ accountCount, serviceIds, location, startDate, endDate, client } = {}) => {
  const resolvedPayload = resolvePricingArgs({ accountCount, serviceIds, location, startDate, endDate, client });
  const {
    location: resolvedLocation,
    client: resolvedClient,
    startDate: resolvedStartDate,
    endDate: resolvedEndDate
  } = resolvedPayload;

  logPricingEvent('pricing_request_received', {
    accountCount: resolvedPayload.accountCount,
    serviceIds: resolvedPayload.serviceIds,
    location: resolvedLocation,
    startDate: resolvedStartDate,
    endDate: resolvedEndDate
  });

  try {
    const query = `
      SELECT
        s.id,
        s.name,
        sl.service_name,
        sl.arm_region_name,
        MIN(COALESCE(sl.retail_price, 0)) AS azure_price,
        sl.currency
      FROM services s
      LEFT JOIN service_locations sl
        ON LOWER(TRIM(sl.service_name)) LIKE '%' || LOWER(TRIM(s.name)) || '%'
      WHERE s.id = ANY($1)
        AND LOWER(sl.arm_region_name) = LOWER($2)
      GROUP BY
        s.id,
        s.name,
        sl.service_name,
        sl.arm_region_name,
        sl.currency
      ORDER BY azure_price ASC
    `;

    const result = await resolvedClient.query(query, [resolvedPayload.serviceIds, resolvedLocation]);
    let rows = Array.isArray(result.rows) ? result.rows : [];

    if (rows.length === 0) {
      const fallbackQuery = `
        SELECT
          s.id,
          s.name,
          COALESCE(s.price_per_user, 0) AS azure_price,
          NULL::text AS service_name,
          NULL::text AS arm_region_name,
          NULL::text AS currency
        FROM services s
        WHERE s.id = ANY($1)
      `;

      const fallbackResult = await resolvedClient.query(fallbackQuery, [resolvedPayload.serviceIds]);
      rows = Array.isArray(fallbackResult.rows) ? fallbackResult.rows : [];
    }

    rows = rows.map((row) => ({
      ...row,
      azure_price: Math.max(0, Number(row.azure_price || 0))
    }));

    console.log({
      event: 'pricing_services_found',
      rows
    });

    const start = parseFlexibleDateTime(startDate);
    const end = parseFlexibleDateTime(endDate);

    if (!start || !end) {
      throw new AppError('endDate must be on or after startDate', 400);
    }

    const startTimestamp = start.getTime();
    const endTimestamp = end.getTime();

    if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp) || endTimestamp < startTimestamp) {
      throw new AppError('endDate must be on or after startDate', 400);
    }

    const duration = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
    const basePrice = rows.reduce((sum, row) => sum + Number(row.azure_price || 0), 0);
    const total = basePrice * duration * Number(resolvedPayload.accountCount);

    logPricingEvent('duration_calculated', {
      startDate: resolvedStartDate,
      endDate: resolvedEndDate,
      duration,
      basePrice
    });

    logPricingEvent('pricing_completed', {
      accountCount: resolvedPayload.accountCount,
      location: resolvedLocation,
      serviceCount: rows.length,
      basePrice,
      totalPrice: total,
      currency: 'USD',
      duration,
      totalUnit: basePrice
    });

    console.log({
      event: 'pricing_result',
      services: rows,
      basePrice,
      duration,
      total
    });

    return {
      success: true,
      services: rows,
      basePrice: Number(basePrice.toFixed(2)),
      duration,
      accounts: Number(resolvedPayload.accountCount),
      totalPrice: Number(total.toFixed(2))
    };
  } catch (error) {
    logPricingEvent('pricing_failed', {
      accountCount: resolvedPayload.accountCount,
      serviceIds: resolvedPayload.serviceIds,
      location: resolvedLocation,
      startDate: resolvedStartDate,
      endDate: resolvedEndDate,
      message: error?.message
    });
    if (error instanceof AppError && error.statusCode === 404) {
      return {
        success: true,
        basePrice: 0,
        duration: 0,
        accounts: Number(resolvedPayload.accountCount),
        totalPrice: 0,
        services: []
      };
    }

    throw error;
  }
};

module.exports = {
  calculatePricing
};
