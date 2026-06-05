const axios = require('axios');
const db = require('../db/postgres');

const CATALOG_SYNC_TTL_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;
const PRICING_API_URL = 'https://prices.azure.com/api/retail/prices';
const RETRY_BACKOFF_MS = [1000, 2000, 5000];

const syncCache = {
  expiresAt: 0,
  value: null,
  inFlight: null
};

const logCatalogEvent = (event, details = {}) => {
  console.log(
    JSON.stringify({
      event,
      service: 'azure-catalog-sync',
      timestamp: new Date().toISOString(),
      ...details
    })
  );
};

const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
};

const resolveItems = (payload) => {
  if (Array.isArray(payload?.Items)) {
    return payload.Items;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  return [];
};

const resolveNextPageLink = (payload) => payload?.nextPageLink || payload?.NextPageLink || null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getStatusCode = (error) => {
  const statusCode = error?.response?.status ?? error?.statusCode ?? error?.status;
  const normalized = Number(statusCode);

  return Number.isFinite(normalized) ? normalized : null;
};

const fetchAzurePageWithRetry = async (url) => {
  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
    try {
      return await axios.get(url, {
        timeout: 30000
      });
    } catch (error) {
      lastError = error;
      const statusCode = getStatusCode(error);

      if (statusCode === 400) {
        throw error;
      }

      const shouldRetry = statusCode === 429 || (statusCode >= 500 && statusCode < 600);

      if (!shouldRetry || attempt === RETRY_BACKOFF_MS.length) {
        throw error;
      }

      await sleep(RETRY_BACKOFF_MS[attempt]);
    }
  }

  throw lastError;
};

const toCatalogRow = (item) => {
  const serviceName = normalizeText(item?.serviceName);
  const serviceFamily = normalizeText(item?.serviceFamily) || 'Uncategorized';
  const azureServiceId = normalizeText(item?.armSkuName);
  const armRegionName = normalizeText(item?.armRegionName);
  const displayLocation = normalizeText(item?.location);
  const currency = normalizeText(item?.currencyCode) || 'USD';
  const numericRetailPrice = Number(item?.retailPrice);
  const safePrice = Number.isFinite(numericRetailPrice) ? Number(numericRetailPrice.toFixed(8)) : 0;
  const unitOfMeasure = normalizeText(item?.unitOfMeasure) || null;
  const effectiveStartDate = item?.effectiveStartDate ? new Date(item.effectiveStartDate) : null;

  return {
    service_name: serviceName,
    service_family: serviceFamily,
    azure_service_id: azureServiceId,
    arm_region_name: armRegionName,
    display_location: displayLocation || armRegionName,
    currency,
    retail_price: safePrice,
    unit_of_measure: unitOfMeasure,
    effective_start_date:
      effectiveStartDate instanceof Date && !Number.isNaN(effectiveStartDate.getTime())
        ? effectiveStartDate
        : null
  };
};

const buildUpsertQuery = (rows) => {
  const values = [];
  const placeholders = rows.map((row, index) => {
    const base = index * 9;

    values.push(
      row.service_name,
      row.service_family,
      row.azure_service_id,
      row.arm_region_name,
      row.display_location,
      row.currency,
      row.retail_price,
      row.unit_of_measure,
      row.effective_start_date
    );

    return `(${Array.from({ length: 9 }, (_, offset) => `$${base + offset + 1}`).join(', ')}, 'azure', NOW())`;
  });

  const query = `
    INSERT INTO service_locations (
      service_name,
      service_family,
      azure_service_id,
      arm_region_name,
      display_location,
      currency,
      retail_price,
      unit_of_measure,
      effective_start_date,
      pricing_source,
      updated_at
    )
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (service_name, arm_region_name)
    DO UPDATE SET
      service_family = EXCLUDED.service_family,
      azure_service_id = EXCLUDED.azure_service_id,
      display_location = EXCLUDED.display_location,
      currency = EXCLUDED.currency,
      retail_price = EXCLUDED.retail_price,
      unit_of_measure = EXCLUDED.unit_of_measure,
      effective_start_date = EXCLUDED.effective_start_date,
      updated_at = NOW()
  `;

  return { query, values };
};

const flushBatch = async (rows, batchNumber, totalRowsProcessed) => {
  if (rows.length === 0) {
    return;
  }

  logCatalogEvent('catalog_batch_started', {
    batchNumber,
    rowsInBatch: rows.length,
    totalRows: totalRowsProcessed
  });

  console.log(
    JSON.stringify({
      event: 'catalog_first_row',
      sample: rows[0],
      timestamp: new Date().toISOString()
    })
  );

  try {
    const uniqueRows = new Map();

    for (const row of rows) {
      const key = `${row.service_name}::${row.arm_region_name}`;

      if (!uniqueRows.has(key)) {
        uniqueRows.set(key, row);
        continue;
      }

      const existing = uniqueRows.get(key);
      const currentEffectiveStart = new Date(row.effective_start_date || 0).getTime();
      const existingEffectiveStart = new Date(existing.effective_start_date || 0).getTime();

      if (currentEffectiveStart > existingEffectiveStart) {
        uniqueRows.set(key, row);
      }
    }

    const rowsToInsert = [...uniqueRows.values()];

    console.log(
      JSON.stringify({
        event: 'catalog_duplicates_removed',
        original: rows.length,
        deduped: rowsToInsert.length
      })
    );

    const { query, values } = buildUpsertQuery(rowsToInsert);

    console.log(
      JSON.stringify({
        event: 'catalog_batch_insert',
        batchSize: values.length,
        timestamp: new Date().toISOString()
      })
    );

    const result = await db.query(query, values);

    console.log(
      JSON.stringify({
        event: 'catalog_batch_success',
        inserted: result.rowCount,
        timestamp: new Date().toISOString()
      })
    );

    return result;
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'catalog_db_error',
        message: err.message,
        code: err.code,
        detail: err.detail,
        position: err.position,
        constraint: err.constraint,
        stack: err.stack,
        timestamp: new Date().toISOString()
      })
    );

    throw err;
  }
};

const syncAzureCatalog = async () => {
  if (syncCache.value && syncCache.expiresAt > Date.now()) {
    return syncCache.value;
  }

  if (syncCache.inFlight) {
    return syncCache.inFlight;
  }

  syncCache.inFlight = (async () => {
    logCatalogEvent('catalog_sync_started');

    try {
      const serviceNames = new Set();
      const locations = new Set();
      const batchBuffer = [];
      let rowsInserted = 0;
      let batchNumber = 0;

      let nextUrl = `${PRICING_API_URL}?$top=${PAGE_SIZE}`;
      let pagesProcessed = 0;
      let partial = false;

      while (nextUrl) {
        let response;

        try {
          response = await fetchAzurePageWithRetry(nextUrl);
        } catch (error) {
          const statusCode = getStatusCode(error);

          if (statusCode === 400) {
            logCatalogEvent('catalog_invalid_page', {
              message: error?.message,
              urlPreview: nextUrl?.slice(0, 120)
            });
            partial = true;
            break;
          }

          logCatalogEvent('catalog_failed', {
            message: error?.message,
            statusCode
          });
          partial = true;
          break;
        }

        const payload = response.data || {};
        const items = Array.isArray(payload.Items) ? payload.Items : [];
        const nextPageLink = resolveNextPageLink(payload);

        pagesProcessed += 1;

        console.log({
          event: 'catalog_page_loaded',
          rows: items.length,
          pageSize: PAGE_SIZE,
          hasNext: Boolean(nextPageLink),
          nextPagePreview: nextPageLink ? nextPageLink.slice(0, 120) : null
        });

        for (const item of items) {
          const serviceName = normalizeText(item?.serviceName);
          const armRegionName = normalizeText(item?.armRegionName);
          const numericRetailPrice = Number(item?.retailPrice);
          const safePrice = Number.isFinite(numericRetailPrice)
            ? Number(numericRetailPrice.toFixed(8))
            : 0;

          if (!serviceName || !armRegionName || !Number.isFinite(numericRetailPrice)) {
            logCatalogEvent('catalog_rows_skipped', {
              pageNumber: pagesProcessed,
              reason: !serviceName
                ? 'missing_serviceName'
                : !armRegionName
                  ? 'missing_armRegionName'
                  : 'missing_retailPrice'
            });
            continue;
          }

          if (safePrice > 999999999999) {
            logCatalogEvent('catalog_price_skipped', {
              pageNumber: pagesProcessed,
              service: item.serviceName,
              region: item.armRegionName,
              price: safePrice
            });
            continue;
          }

          console.log({
            event: 'catalog_price',
            price: safePrice
          });

          console.log('catalog_insert', {
            service: item.serviceName,
            region: item.armRegionName
          });

          const row = toCatalogRow(item);

          batchBuffer.push(row);
          serviceNames.add(row.service_name);
          locations.add(row.arm_region_name);
          rowsInserted += 1;

          if (batchBuffer.length >= PAGE_SIZE) {
            batchNumber += 1;
            const batch = batchBuffer.splice(0, PAGE_SIZE);
            await flushBatch(batch, batchNumber, rowsInserted);
          }
        }

        nextUrl = nextPageLink || null;
      }

      if (batchBuffer.length > 0) {
        batchNumber += 1;
        await flushBatch(batchBuffer, batchNumber, rowsInserted);
      }

      const result = {
        success: true,
        pagesProcessed,
        rowsInserted,
        partial,
        totalServices: serviceNames.size,
        totalLocations: locations.size,
        totalRows: rowsInserted
      };

      syncCache.value = result;
      syncCache.expiresAt = Date.now() + CATALOG_SYNC_TTL_MS;

      logCatalogEvent('catalog_completed', result);

      return result;
    } catch (error) {
      logCatalogEvent('catalog_failed', {
        message: error?.message
      });

      return {
        success: true,
        pagesProcessed: 0,
        rowsInserted: 0,
        partial: true,
        totalServices: 0,
        totalLocations: 0,
        totalRows: 0
      };
    } finally {
      syncCache.inFlight = null;
    }
  })();

  return syncCache.inFlight;
};

const buildServiceRow = (row) => ({
  id: `${row.service_name}:${row.arm_region_name}`,
  name: row.service_name,
  category: row.service_family,
  azure_role: row.service_name,
  description: `${row.service_family} in ${row.arm_region_name}`,
  price_per_user: Number.isFinite(Number(row.retail_price)) ? Number(row.retail_price) : 0,
  active: true,
  location: row.display_location || row.arm_region_name,
  currency_code: row.currency,
  unit_of_measure: row.unit_of_measure
});

const getDistinctLocations = async () => {
  const result = await db.query(
    `
      SELECT DISTINCT
        LOWER(TRIM(arm_region_name)) AS arm_region_name,
        COALESCE(NULLIF(display_location, ''), arm_region_name) AS display_location
      FROM service_locations
      WHERE arm_region_name IS NOT NULL
        AND arm_region_name <> ''
      ORDER BY 2, 1
    `
  );

  return result.rows.map((row) => ({
    arm_region_name: row.arm_region_name,
    display_location: row.display_location
  }));
};

const getServicesForLocation = async (location, category) => {
  const hasLocation = typeof location === 'string' && location.trim().length > 0;
  const hasCategory = typeof category === 'string' && category.trim().length > 0;

  if (!hasLocation) {
    const values = [];
    let query = `
      SELECT
        id,
        name,
        category,
        azure_role,
        description,
        price_per_user,
        active
      FROM services
      WHERE active = true
    `;

    if (hasCategory) {
      values.push(category.trim());
      query += ` AND category = $${values.length}`;
    }

    query += ' ORDER BY name';

    const result = await db.query(query, values);

    return result.rows.map((service) => ({
      ...service,
      price_per_user: Number(service.price_per_user),
      active: Boolean(service.active)
    }));
  }

  const values = [location.trim()];
  let query = `
    SELECT DISTINCT ON (sl.service_name)
      sl.service_name,
      sl.service_family,
      sl.arm_region_name,
      sl.display_location,
      sl.currency,
      sl.retail_price,
      sl.unit_of_measure
    FROM service_locations sl
    WHERE (
      LOWER(sl.arm_region_name) = LOWER($1)
      OR LOWER(sl.display_location) = LOWER($1)
    )
  `;

  if (hasCategory) {
    values.push(category.trim());
    query += `
      AND (
        LOWER(sl.service_family) = LOWER($${values.length})
        OR LOWER(sl.service_name) = LOWER($${values.length})
      )
    `;
  }

  query += `
    ORDER BY sl.service_name, sl.retail_price ASC NULLS LAST
  `;

  const result = await db.query(query, values);

  return result.rows.map(buildServiceRow);
};

module.exports = {
  syncAzureCatalog,
  getDistinctLocations,
  getServicesForLocation
};
