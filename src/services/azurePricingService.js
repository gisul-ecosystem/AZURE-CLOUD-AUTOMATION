const axios = require('axios');
const { getAzureServiceName } = require('./servicePricingMap');

const CACHE_TTL_MS = 5 * 60 * 1000;
const pricingCache = new Map();
const filterCache = new Map();

const DEFAULT_LOCATION = process.env.AZURE_PRICING_DEFAULT_REGION || 'centralindia';
const PRICING_API_URL = 'https://prices.azure.com/api/retail/prices';

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
    const response = await axios.get(nextUrl, {
      params: nextParams,
      timeout: 20000
    });

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

const fetchAzureRetailPrices = async (serviceName, location) => {
  const filter = `serviceName eq '${escapeODataString(serviceName)}' and armRegionName eq '${escapeODataString(location)}' and priceType eq 'Consumption'`;
  return fetchRetailPriceItems(filter);
};

const getAzureRetailPrice = async (serviceName, location) => {
  const azureServiceName = getAzureServiceName(serviceName);

  if (!azureServiceName) {
    return null;
  }

  const normalizedLocation = normalizeLocation(location);
  const cacheKey = `${azureServiceName.toLowerCase()}|${normalizedLocation}`;
  const cachedPrice = getCachedPrice(cacheKey);

  if (cachedPrice) {
    return cachedPrice;
  }

  logAzurePricingEvent('azure_price_lookup_started', {
    serviceName: azureServiceName,
    location: normalizedLocation
  });

  try {
    const items = await fetchAzureRetailPrices(azureServiceName, normalizedLocation);
    const bestItem = selectBestPrice(items);

    if (!bestItem) {
      logAzurePricingEvent('azure_price_lookup_completed', {
        serviceName: azureServiceName,
        location: normalizedLocation,
        cached: false,
        found: false
      });
      return null;
    }

    const priceResult = {
      retailPrice: Number(bestItem.retailPrice),
      currency: bestItem.currencyCode || 'USD',
      serviceName: bestItem.serviceName || azureServiceName,
      armRegionName: bestItem.armRegionName || normalizedLocation,
      unitOfMeasure: bestItem.unitOfMeasure || null,
      source: 'azure-retail',
      raw: bestItem
    };

    setCachedPrice(cacheKey, priceResult);

    logAzurePricingEvent('azure_price_lookup_completed', {
      serviceName: azureServiceName,
      location: normalizedLocation,
      cached: false,
      found: true,
      retailPrice: priceResult.retailPrice,
      currency: priceResult.currency
    });

    return priceResult;
  } catch (error) {
    logAzurePricingEvent('azure_price_lookup_completed', {
      serviceName: azureServiceName,
      location: normalizedLocation,
      cached: false,
      found: false,
      error: error?.message || 'Azure pricing lookup failed'
    });

    return null;
  }
};

module.exports = {
  getAzureRetailPrice,
  fetchRetailPriceItems,
  retailPriceToDaily,
  selectLowestDailyPrice
};
