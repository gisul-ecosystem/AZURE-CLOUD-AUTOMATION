const axios = require('axios');
const { createAzureCredential, validateAzureEnv } = require('../config/azure');
const { getRegionalDailyPricesForServices } = require('./estimatePricingService');
const AppError = require('../utils/AppError');

const CACHE_TTL_MS = 5 * 60 * 1000;
const subscriptionLocationsCache = {
  expiresAt: 0,
  locations: []
};

const isProvisionableLocation = (location) => {
  const armRegionName = String(location?.arm_region_name || location?.name || '')
    .trim()
    .toLowerCase();
  const displayLocation = String(location?.display_location || location?.displayName || '').trim();

  if (!armRegionName) {
    return false;
  }

  if (/stage/i.test(armRegionName) || /\(stage\)/i.test(displayLocation)) {
    return false;
  }

  const regionType = String(location?.metadata?.regionType || '').trim();
  if (regionType === 'Logical') {
    return false;
  }

  return true;
};

const assertProvisionableLocation = (location) => {
  const armRegionName = String(location || '').trim().toLowerCase();

  if (!armRegionName) {
    throw new AppError('Request location is missing.', 400);
  }

  if (!isProvisionableLocation({ arm_region_name: armRegionName })) {
    throw new AppError(
      `Region '${armRegionName}' is a preview/stage region and cannot host resource groups. Choose a production region such as eastasia, southeastasia, or centralindia.`,
      400
    );
  }
};

const getManagementAccessToken = async () => {
  const azureConfig = validateAzureEnv();
  const credential = createAzureCredential(azureConfig);
  const token = await credential.getToken('https://management.azure.com/.default');

  return {
    accessToken: token.token,
    subscriptionId: azureConfig.subscriptionId
  };
};

const getSubscriptionLocations = async () => {
  if (subscriptionLocationsCache.expiresAt > Date.now()) {
    return subscriptionLocationsCache.locations;
  }

  const { accessToken, subscriptionId } = await getManagementAccessToken();
  const response = await axios.get(
    `https://management.azure.com/subscriptions/${subscriptionId}/locations`,
    {
      params: { 'api-version': '2022-12-01' },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000
    }
  );

  const locations = (response.data?.value || [])
    .map((entry) => {
      const armRegionName = String(entry?.name || '').trim().toLowerCase();
      const displayLocation = String(
        entry?.regionalDisplayName || entry?.displayName || entry?.name || ''
      ).trim();

      if (!armRegionName) {
        return null;
      }

      return {
        arm_region_name: armRegionName,
        display_location: displayLocation || armRegionName,
        metadata: entry?.metadata || null
      };
    })
    .filter((location) => location && isProvisionableLocation(location))
    .sort((left, right) => left.display_location.localeCompare(right.display_location));

  subscriptionLocationsCache.locations = locations;
  subscriptionLocationsCache.expiresAt = Date.now() + CACHE_TTL_MS;

  return locations;
};

const getLocationsForSelectedServices = async (
  services = [],
  instancesByServiceId = new Map(),
  selectedInstancesByServiceId = {}
) => {
  const subscriptionLocations = await getSubscriptionLocations();
  const regionalDailyPrices = await getRegionalDailyPricesForServices(
    services,
    instancesByServiceId,
    selectedInstancesByServiceId
  );

  return subscriptionLocations
    .map((location) => ({
      ...location,
      base_price: Number((regionalDailyPrices.get(location.arm_region_name) || 0).toFixed(4)),
      currency: 'USD'
    }))
    .sort((left, right) => {
      if (left.base_price !== right.base_price) {
        return left.base_price - right.base_price;
      }

      return left.display_location.localeCompare(right.display_location);
    });
};

module.exports = {
  isProvisionableLocation,
  assertProvisionableLocation,
  getSubscriptionLocations,
  getLocationsForSelectedServices
};
