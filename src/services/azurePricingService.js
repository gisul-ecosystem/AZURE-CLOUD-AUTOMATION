const axios = require('axios');
const { resolveAzureRetailServiceName } = require('./servicePricingMap');

const CACHE_TTL_MS = 30 * 60 * 1000;
const pricingCache = new Map();
const filterCache = new Map();

const DEFAULT_LOCATION = process.env.AZURE_PRICING_DEFAULT_REGION || 'centralindia';
const PRICING_API_URL = 'https://prices.azure.com/api/retail/prices';
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRY_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 300;

const logAzurePricingEvent = (event, details = {}) => {
  console.log(
    JSON.stringify({
      event,
      service: 'azure-pricing',
      timestamp: new Date().toISOString(),
      ...details
    })
  );
};

const escapeODataString = (value) => String(value).replace(/'/g, "''");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableError = (error) => {
  const statusCode = Number(error?.response?.status || error?.statusCode || error?.status);

  if (RETRYABLE_STATUS_CODES.has(statusCode)) {
    return true;
  }

  return !statusCode && Boolean(error?.code);
};

const withRetry = async (operation, { attempts = MAX_RETRY_ATTEMPTS, baseDelayMs = RETRY_BASE_DELAY_MS } = {}) => {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt === attempts) {
        throw error;
      }

      const retryAfterSeconds = Number(error?.response?.headers?.['retry-after']);
      const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : 0;
      const backoffMs = retryAfterMs || baseDelayMs * (2 ** (attempt - 1));
      await sleep(backoffMs);
    }
  }

  throw lastError;
};

const formatCurrencyAmount = (amount, currency = 'USD') => {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return null;
  }

  const minimumFractionDigits = value >= 1 ? 2 : 0;
  const maximumFractionDigits = value >= 1 ? 2 : 6;

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits,
    maximumFractionDigits
  }).format(value);
};

const formatBillingUnit = (unitOfMeasure) => {
  const raw = String(unitOfMeasure || '').trim();
  if (!raw) {
    return '';
  }

  const normalized = raw
    .replace(/^1\s+/i, '')
    .replace(/^1000\s+/i, '1,000 ')
    .replace(/^10000\s+/i, '10,000 ')
    .replace(/\/+/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized;
};

const buildDisplayPrice = (price, currency, unitOfMeasure) => {
  const formattedPrice = formatCurrencyAmount(price, currency);
  const formattedUnit = formatBillingUnit(unitOfMeasure);

  if (!formattedPrice) {
    return null;
  }

  if (!formattedUnit) {
    return formattedPrice;
  }

  return `${formattedPrice} / ${formattedUnit}`;
};

const normalizeLocation = (location) => {
  const rawLocation = typeof location === 'string' && location.trim().length > 0 ? location : DEFAULT_LOCATION;

  return rawLocation.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
};

const getCachedPrice = (cacheKey) => {
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

const setCachedPrice = (cacheKey, value) => {
  pricingCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
};

const getCachedFilterItems = (filter) => {
  const cachedEntry = filterCache.get(filter);
  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    filterCache.delete(filter);
    return null;
  }

  return cachedEntry.value;
};

const setCachedFilterItems = (filter, value) => {
  filterCache.set(filter, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
};

const normalizeRegion = (region) => {
  if (typeof region !== 'string') {
    return '';
  }

  return region.trim().toLowerCase();
};

const normalizeSku = (sku) => {
  if (typeof sku !== 'string') {
    return '';
  }

  return sku.trim();
};

const selectBestPrice = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  return items.reduce((bestItem, currentItem) => {
    const currentPrice = Number(currentItem?.retailPrice);
    const bestPrice = Number(bestItem?.retailPrice);

    if (!Number.isFinite(currentPrice)) {
      return bestItem;
    }

    if (!Number.isFinite(bestPrice)) {
      return currentItem;
    }

    return currentPrice < bestPrice ? currentItem : bestItem;
  }, null);
};

const retailPriceToDaily = (retailPrice, unitOfMeasure) => {
  const price = Number(retailPrice);
  if (!Number.isFinite(price) || price < 0) {
    return 0;
  }

  const unit = String(unitOfMeasure || '').toLowerCase();

  if (unit.includes('hour')) {
    return price * 24;
  }

  if (unit.includes('month')) {
    return price / 30;
  }

  if (unit.includes('day')) {
    return price;
  }

  if (unit.includes('year')) {
    return price / 365;
  }

  return price;
};

const selectLowestDailyPrice = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return 0;
  }

  const linuxPreferred = items.filter((item) => {
    const label = `${item?.productName || ''} ${item?.skuName || ''} ${item?.meterName || ''}`;
    return !/windows/i.test(label);
  });
  const candidates = linuxPreferred.length > 0 ? linuxPreferred : items;

  let lowest = Number.POSITIVE_INFINITY;

  for (const item of candidates) {
    const dailyPrice = retailPriceToDaily(item.retailPrice, item.unitOfMeasure);
    if (dailyPrice < lowest) {
      lowest = dailyPrice;
    }
  }

  return Number.isFinite(lowest) ? lowest : 0;
};

const fetchRetailPriceItems = async (filter) => {
  const normalizedFilter = String(filter || '').trim();
  if (!normalizedFilter) {
    return [];
  }

  const cachedItems = getCachedFilterItems(normalizedFilter);
  if (cachedItems) {
    return cachedItems;
  }

  const items = [];
  let nextUrl = PRICING_API_URL;
  let nextParams = { $filter: normalizedFilter };

  while (nextUrl) {
    const response = await withRetry(
      () =>
        axios.get(nextUrl, {
          params: nextParams,
          timeout: 20000
        }),
      { attempts: MAX_RETRY_ATTEMPTS, baseDelayMs: RETRY_BASE_DELAY_MS }
    );

    const payload = response.data || {};
    if (Array.isArray(payload.Items)) {
      items.push(...payload.Items);
    }

    nextUrl = payload.NextPageLink || null;
    nextParams = undefined;
  }

  setCachedFilterItems(normalizedFilter, items);
  return items;
};

const buildRetailPricingFilter = ({ serviceName, region, sku }) => {
  const mappedServiceName = resolveAzureRetailServiceName(serviceName);
  const normalizedRegion = normalizeRegion(region);
  const normalizedSku = normalizeSku(sku);

  if (!mappedServiceName || !normalizedRegion) {
    return null;
  }

  const filters = [
    `serviceName eq '${escapeODataString(mappedServiceName)}'`,
    `armRegionName eq '${escapeODataString(normalizedRegion)}'`,
    `priceType eq 'Consumption'`
  ];

  if (normalizedSku) {
    filters.push(`(armSkuName eq '${escapeODataString(normalizedSku)}' or contains(skuName,'${escapeODataString(normalizedSku)}'))`);
  }

  return {
    filter: filters.join(' and '),
    serviceName: mappedServiceName,
    region: normalizedRegion,
    sku: normalizedSku || null
  };
};

const findBestRetailPriceItem = (items, sku) => {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const normalizedSku = normalizeSku(sku).toLowerCase();
  const candidates = normalizedSku
    ? items.filter((item) => {
        const armSku = String(item?.armSkuName || '').trim().toLowerCase();
        const skuName = String(item?.skuName || '').trim().toLowerCase();
        const meterName = String(item?.meterName || '').trim().toLowerCase();

        return (
          armSku === normalizedSku ||
          skuName.includes(normalizedSku) ||
          meterName.includes(normalizedSku)
        );
      })
    : items;

  const baseCandidates = candidates.length > 0 ? candidates : items;
  return selectBestPrice(baseCandidates);
};

const lookupAzureRetailPrice = async ({ service, region, sku }) => {
  const mapping = buildRetailPricingFilter({ serviceName: service, region, sku });

  if (!mapping) {
    return {
      service: String(service || '').trim(),
      location: String(region || '').trim().toLowerCase(),
      sku: sku ? String(sku).trim() : null,
      price: null,
      currency: 'USD',
      unit: '',
      displayPrice: null,
      message: 'Pricing unavailable'
    };
  }

  const cacheKey = `${mapping.serviceName.toLowerCase()}|${mapping.region}|${mapping.sku || ''}`;
  const cachedPrice = getCachedPrice(cacheKey);

  if (cachedPrice) {
    return cachedPrice;
  }

  logAzurePricingEvent('azure_price_lookup_started', {
    serviceName: mapping.serviceName,
    location: mapping.region,
    sku: mapping.sku || null
  });

  try {
    const items = await fetchRetailPriceItems(mapping.filter);
    const bestItem = findBestRetailPriceItem(items, mapping.sku);

    if (!bestItem) {
      const fallback = {
        service: mapping.serviceName,
        location: mapping.region,
        sku: mapping.sku || null,
        price: null,
        currency: 'USD',
        unit: '',
        displayPrice: null,
        message: 'Pricing unavailable'
      };

      setCachedPrice(cacheKey, fallback);
      return fallback;
    }

    const price = Number(bestItem.unitPrice ?? bestItem.retailPrice);
    const currency = bestItem.currencyCode || 'USD';
    const unit = bestItem.unitOfMeasure || '';
    const result = {
      service: bestItem.serviceName || mapping.serviceName,
      location: bestItem.armRegionName || mapping.region,
      sku: bestItem.armSkuName || mapping.sku || null,
      price: Number.isFinite(price) ? price : null,
      currency,
      unit,
      displayPrice: Number.isFinite(price) ? buildDisplayPrice(price, currency, unit) : null,
      message: Number.isFinite(price) ? undefined : 'Pricing unavailable',
      source: 'azure-retail-prices-api',
      raw: bestItem
    };

    setCachedPrice(cacheKey, result);

    logAzurePricingEvent('azure_price_lookup_completed', {
      serviceName: result.service,
      location: result.location,
      sku: result.sku,
      cached: false,
      found: true,
      unit: result.unit,
      price: result.price,
      currency: result.currency
    });

    return result;
  } catch (error) {
    const fallback = {
      service: mapping.serviceName,
      location: mapping.region,
      sku: mapping.sku || null,
      price: null,
      currency: 'USD',
      unit: '',
      displayPrice: null,
      message: 'Pricing unavailable'
    };

    logAzurePricingEvent('azure_price_lookup_completed', {
      serviceName: mapping.serviceName,
      location: mapping.region,
      sku: mapping.sku || null,
      cached: false,
      found: false,
      error: error?.message || 'Azure pricing lookup failed'
    });

    return fallback;
  }
};

const getAzureRetailPrice = async (serviceName, location, sku) => {
  const result = await lookupAzureRetailPrice({
    service: serviceName,
    region: location,
    sku
  });

  if (!result || result.price === null) {
    return null;
  }

  return {
    retailPrice: result.price,
    currency: result.currency,
    serviceName: result.service,
    armRegionName: result.location,
    armSkuName: result.sku,
    unitOfMeasure: result.unit,
    displayPrice: result.displayPrice,
    source: result.source,
    raw: result.raw
  };
};

module.exports = {
  buildDisplayPrice,
  buildRetailPricingFilter,
  fetchRetailPriceItems,
  getAzureRetailPrice,
  lookupAzureRetailPrice,
  retailPriceToDaily,
  selectLowestDailyPrice,
  formatBillingUnit
};
