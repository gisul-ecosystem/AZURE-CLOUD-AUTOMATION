const axios = require('axios');
const { createAzureCredential, validateAzureEnv } = require('../config/azure');
const {
  getRegionalDailyPricesForServices,
  getPortalDailyFees
} = require('./estimatePricingService');
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

  // Staging, preview, and EUAP regions appear in subscription listings but cannot host resource groups.
  if (
    /stage|euap|preview/i.test(armRegionName) ||
    /stg$/i.test(armRegionName) ||
    /\(stage\)|\(stg\)|\(preview\)/i.test(displayLocation)
  ) {
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

const resolveInstanceOptionForLocation = (
  serviceId,
  instancesByServiceId,
  selectedInstancesByServiceId
) => {
  const selected =
    selectedInstancesByServiceId?.[serviceId] ?? selectedInstancesByServiceId?.[String(serviceId)];

  if (selected) {
    return String(selected).trim();
  }

  const options = instancesByServiceId.get(Number(serviceId)) || [];

  if (options.length === 0) {
    return '';
  }

  const paidOption = options.find((option) => !/free/i.test(String(option?.option_name || '')));
  return (paidOption || options[0])?.option_name || '';
};

const filterLocationsForSelectedInstances = async (
  locations,
  services,
  instancesByServiceId,
  selectedInstancesByServiceId
) => {
  const { filterInstancesForLocation, serviceSupportsInstances } = require('./instanceAvailabilityService');

  const servicesById = new Map(
    services.map((service) => [
      Number(service.id),
      {
        id: Number(service.id),
        name: service.name,
        price_per_user: Number(service.price_per_user || 0)
      }
    ])
  );

  const instancesToValidate = services
    .filter((service) => serviceSupportsInstances(service.name))
    .map((service) => {
      const serviceId = Number(service.id);
      const optionName = resolveInstanceOptionForLocation(
        serviceId,
        instancesByServiceId,
        selectedInstancesByServiceId
      );

      if (!optionName) {
        return null;
      }

      return {
        serviceId,
        service_id: serviceId,
        option_name: optionName
      };
    })
    .filter(Boolean);

  if (instancesToValidate.length === 0) {
    return locations;
  }

  const availabilityChecks = await Promise.all(
    locations.map(async (location) => {
      const filtered = await filterInstancesForLocation(
        location.arm_region_name,
        instancesToValidate,
        servicesById
      );

      return filtered.length === instancesToValidate.length ? location : null;
    })
  );

  return availabilityChecks.filter(Boolean);
};

const getLocationsForSelectedServices = async (
  services = [],
  instancesByServiceId = new Map(),
  selectedInstancesByServiceId = {}
) => {
  const subscriptionLocations = await getSubscriptionLocations();
  const eligibleLocations = await filterLocationsForSelectedInstances(
    subscriptionLocations,
    services,
    instancesByServiceId,
    selectedInstancesByServiceId
  );
  const [regionalDailyPrices, portalDailyFee] = await Promise.all([
    getRegionalDailyPricesForServices(
      services,
      instancesByServiceId,
      selectedInstancesByServiceId
    ),
    Promise.resolve(getPortalDailyFees(services))
  ]);

  return eligibleLocations
    .map((location) => {
      const infraPrice = Number(regionalDailyPrices.get(location.arm_region_name) || 0);
      const basePrice = infraPrice + portalDailyFee;

      return {
        ...location,
        base_price: basePrice,
        basePrice,
        currency: 'USD'
      };
    })
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
