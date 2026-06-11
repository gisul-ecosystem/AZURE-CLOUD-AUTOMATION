const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const { parseFlexibleDateTime } = require('../utils/dateTime');
const { getAzureServiceName } = require('./servicePricingMap');
const { isVirtualMachineService, normalizeVmSize } = require('../utils/vmSize');
const {
  mapAppServiceSku,
  mapSqlSku,
  mapStorageSku,
  mapServiceBusSku,
  mapKeyVaultSku,
  mapAksNodeVmSize
} = require('../utils/instancePolicyRules');
const {
  fetchRetailPriceItems,
  retailPriceToDaily,
  selectLowestDailyPrice
} = require('./azurePricingService');

const ROLE_PRICE_MARKUP = 0;

const escapeODataString = (value) => String(value || '').replace(/'/g, "''");

const mapFoundrySku = (instanceOption, paidSku) =>
  /free/i.test(String(instanceOption || '')) ? 'Free' : paidSku;

const FOUNDRY_RETAIL_PROFILES = [
  {
    pattern: /document intelligence/i,
    productContains: 'Document Intelligence',
    mapSku: (instanceOption) => mapFoundrySku(instanceOption, 'S0')
  },
  {
    pattern: /ai vision/i,
    productContains: 'Vision',
    mapSku: (instanceOption) => mapFoundrySku(instanceOption, 'Standard')
  },
  {
    pattern: /ai language/i,
    productContains: 'Language',
    mapSku: (instanceOption) => mapFoundrySku(instanceOption, 'S0')
  },
  {
    pattern: /ai speech/i,
    productContains: 'Speech',
    mapSku: (instanceOption) => mapFoundrySku(instanceOption, 'S1')
  }
];

const buildFoundryToolsFilter = (productContains, skuName) =>
  `serviceName eq 'Foundry Tools' ` +
  `and contains(productName,'${escapeODataString(productContains)}') ` +
  `and skuName eq '${escapeODataString(skuName)}' ` +
  `and priceType eq 'Consumption'`;

const resolveInstanceOption = (serviceId, instancesByServiceId, selectedInstancesByServiceId) => {
  const selected = selectedInstancesByServiceId?.[serviceId] ?? selectedInstancesByServiceId?.[String(serviceId)];
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

const buildRetailFilter = (service, instanceOption) => {
  const serviceName = String(service.name || service.azure_role || service.category || '');
  const azureServiceName = getAzureServiceName(serviceName);

  if (!azureServiceName) {
    return null;
  }

  const foundryProfile = FOUNDRY_RETAIL_PROFILES.find((profile) => profile.pattern.test(serviceName));
  if (foundryProfile) {
    return buildFoundryToolsFilter(foundryProfile.productContains, foundryProfile.mapSku(instanceOption));
  }

  if (isVirtualMachineService(service.name)) {
    const vmSize = normalizeVmSize(instanceOption);
    return (
      `serviceName eq '${escapeODataString(azureServiceName)}' ` +
      `and armSkuName eq '${escapeODataString(vmSize)}' ` +
      `and priceType eq 'Consumption'`
    );
  }

  if (/app service|functions/i.test(serviceName)) {
    const skuToken = mapAppServiceSku(instanceOption);
    return (
      `serviceName eq '${escapeODataString(azureServiceName)}' ` +
      `and contains(skuName,'${escapeODataString(skuToken)}') ` +
      `and priceType eq 'Consumption'`
    );
  }

  if (/sql database/i.test(serviceName)) {
    const skuToken = mapSqlSku(instanceOption);
    return (
      `serviceName eq '${escapeODataString(azureServiceName)}' ` +
      `and contains(skuName,'${escapeODataString(skuToken)}') ` +
      `and priceType eq 'Consumption'`
    );
  }

  if (/blob storage|data lake storage/i.test(serviceName)) {
    const skuToken = mapStorageSku(instanceOption);
    return (
      `serviceName eq '${escapeODataString(azureServiceName)}' ` +
      `and contains(skuName,'${escapeODataString(skuToken)}') ` +
      `and priceType eq 'Consumption'`
    );
  }

  if (/service bus/i.test(serviceName)) {
    const skuToken = mapServiceBusSku(instanceOption);
    return (
      `serviceName eq '${escapeODataString(azureServiceName)}' ` +
      `and contains(skuName,'${escapeODataString(skuToken)}') ` +
      `and priceType eq 'Consumption'`
    );
  }

  if (/key vault/i.test(serviceName)) {
    const skuToken = mapKeyVaultSku(instanceOption);
    return (
      `serviceName eq '${escapeODataString(azureServiceName)}' ` +
      `and contains(skuName,'${escapeODataString(skuToken)}') ` +
      `and priceType eq 'Consumption'`
    );
  }

  if (/kubernetes/i.test(serviceName)) {
    const vmSize = mapAksNodeVmSize(instanceOption);
    return (
      `serviceName eq '${escapeODataString(azureServiceName)}' ` +
      `and armSkuName eq '${escapeODataString(vmSize)}' ` +
      `and priceType eq 'Consumption'`
    );
  }

  if (/cosmos db/i.test(serviceName)) {
    const skuToken = String(instanceOption || 'Serverless').trim();
    return (
      `serviceName eq '${escapeODataString(azureServiceName)}' ` +
      `and contains(skuName,'${escapeODataString(skuToken)}') ` +
      `and priceType eq 'Consumption'`
    );
  }

  if (/logic app/i.test(serviceName)) {
    const skuToken = /standard/i.test(String(instanceOption || '')) ? 'Standard' : 'Consumption';
    return (
      `serviceName eq '${escapeODataString(azureServiceName)}' ` +
      `and contains(skuName,'${escapeODataString(skuToken)}') ` +
      `and priceType eq 'Consumption'`
    );
  }

  return `serviceName eq '${escapeODataString(azureServiceName)}' and priceType eq 'Consumption'`;
};

const aggregateDailyPricesByRegion = (items) => {
  const byRegion = new Map();

  for (const item of items) {
    const region = String(item?.armRegionName || '').trim().toLowerCase();
    if (!region) {
      continue;
    }

    const dailyPrice = retailPriceToDaily(Number(item.retailPrice), item.unitOfMeasure);
    if (!Number.isFinite(dailyPrice) || dailyPrice < 0) {
      continue;
    }

    const current = byRegion.get(region);
    if (current === undefined || dailyPrice < current) {
      byRegion.set(region, dailyPrice);
    }
  }

  return byRegion;
};

const getServiceRegionalDailyPrices = async (service, instanceOption) => {
  const filter = buildRetailFilter(service, instanceOption);
  if (!filter) {
    return new Map();
  }

  const items = await fetchRetailPriceItems(filter);
  return aggregateDailyPricesByRegion(items);
};

const mergeRegionalPriceMaps = (maps) => {
  const merged = new Map();

  for (const priceMap of maps) {
    for (const [region, price] of priceMap.entries()) {
      merged.set(region, (merged.get(region) || 0) + price);
    }
  }

  return merged;
};

const loadPricingContext = async (serviceIds) => {
  const normalizedServiceIds = Array.from(
    new Set(
      (Array.isArray(serviceIds) ? serviceIds : [])
        .map((serviceId) => Number(serviceId))
        .filter((serviceId) => Number.isInteger(serviceId) && serviceId > 0)
    )
  );

  if (normalizedServiceIds.length === 0) {
    return {
      services: [],
      instancesByServiceId: new Map()
    };
  }

  const [servicesResult, instancesResult] = await Promise.all([
    db.query(
      `
        SELECT
          id,
          name,
          azure_role,
          category,
          COALESCE(price_per_user, 0) AS price_per_user
        FROM services
        WHERE id = ANY($1::int[])
      `,
      [normalizedServiceIds]
    ),
    db.query(
      `
        SELECT
          service_id,
          option_name
        FROM service_instance_options
        WHERE service_id = ANY($1::bigint[])
        ORDER BY service_id, sort_order, option_name
      `,
      [normalizedServiceIds]
    )
  ]);

  const instancesByServiceId = new Map();
  instancesResult.rows.forEach((row) => {
    const serviceId = Number(row.service_id);
    if (!instancesByServiceId.has(serviceId)) {
      instancesByServiceId.set(serviceId, []);
    }
    instancesByServiceId.get(serviceId).push({ option_name: row.option_name });
  });

  return {
    services: servicesResult.rows,
    instancesByServiceId
  };
};

const getPortalDailyFees = (services) =>
  services.reduce((sum, service) => sum + Math.max(0, Number(service.price_per_user || 0)), 0);

const getRegionalDailyPricesForServices = async (
  services,
  instancesByServiceId,
  selectedInstancesByServiceId = {}
) => {
  const priceMaps = await Promise.all(
    services.map(async (service) => {
      const serviceId = Number(service.id);
      const instanceOption = resolveInstanceOption(
        serviceId,
        instancesByServiceId,
        selectedInstancesByServiceId
      );
      return getServiceRegionalDailyPrices(service, instanceOption);
    })
  );

  return mergeRegionalPriceMaps(priceMaps);
};

const getDailyPriceForLocation = async (
  services,
  instancesByServiceId,
  selectedInstancesByServiceId,
  location
) => {
  const normalizedLocation = String(location || '').trim().toLowerCase();
  let dailyTotal = getPortalDailyFees(services);

  for (const service of services) {
    const serviceId = Number(service.id);
    const instanceOption = resolveInstanceOption(
      serviceId,
      instancesByServiceId,
      selectedInstancesByServiceId
    );
    const filter = buildRetailFilter(service, instanceOption);

    if (!filter) {
      continue;
    }

    const items = await fetchRetailPriceItems(
      `${filter} and armRegionName eq '${escapeODataString(normalizedLocation)}'`
    );
    const dailyPrice = selectLowestDailyPrice(items);
    dailyTotal += dailyPrice;
  }

  return dailyTotal;
};

const normalizeSelectedInstances = (selectedInstances) => {
  if (!Array.isArray(selectedInstances)) {
    return {};
  }

  return selectedInstances.reduce((accumulator, entry) => {
    const serviceId = Number(entry?.serviceId ?? entry?.service_id);
    const instanceOption = String(entry?.instanceOption ?? entry?.instance_option ?? '').trim();

    if (Number.isInteger(serviceId) && serviceId > 0 && instanceOption) {
      accumulator[serviceId] = instanceOption;
    }

    return accumulator;
  }, {});
};

const calculateEstimate = async ({
  accountCount,
  serviceIds,
  location,
  startDate,
  endDate,
  selectedInstances = [],
  selectedRoles = []
}) => {
  const resolvedAccountCount = Number(accountCount);
  if (!Number.isInteger(resolvedAccountCount) || resolvedAccountCount <= 0) {
    throw new AppError('accountCount must be a positive integer.', 400);
  }

  const { services, instancesByServiceId } = await loadPricingContext(serviceIds);
  if (services.length === 0) {
    throw new AppError('No valid services found for pricing.', 400);
  }

  const selectedInstancesByServiceId = normalizeSelectedInstances(selectedInstances);
  const start = parseFlexibleDateTime(startDate);
  const end = parseFlexibleDateTime(endDate);

  if (!start || !end || end < start) {
    throw new AppError('endDate must be on or after startDate', 400);
  }

  const durationDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
  const roleCount = Array.isArray(selectedRoles) ? selectedRoles.length : 0;
  const roleMarkupDaily = roleCount * ROLE_PRICE_MARKUP;

  const baseDailyPrice =
    (await getDailyPriceForLocation(
      services,
      instancesByServiceId,
      selectedInstancesByServiceId,
      location
    )) + roleMarkupDaily;

  const totalPrice = baseDailyPrice * durationDays * resolvedAccountCount;

  const lineItems = await Promise.all(
    services.map(async (service) => {
      const serviceId = Number(service.id);
      const instanceOption = resolveInstanceOption(
        serviceId,
        instancesByServiceId,
        selectedInstancesByServiceId
      );
      const filter = buildRetailFilter(service, instanceOption);
      const items = filter
        ? await fetchRetailPriceItems(
            `${filter} and armRegionName eq '${escapeODataString(String(location || '').trim().toLowerCase())}'`
          )
        : [];
      const infraDaily = selectLowestDailyPrice(items);
      const portalDaily = Math.max(0, Number(service.price_per_user || 0));

      return {
        serviceId,
        name: service.name,
        instanceOption: instanceOption || null,
        infraDailyPrice: Number(infraDaily.toFixed(4)),
        portalDailyPrice: Number(portalDaily.toFixed(4)),
        dailyPrice: Number((infraDaily + portalDaily).toFixed(4))
      };
    })
  );

  return {
    success: true,
    basePrice: Number(baseDailyPrice.toFixed(2)),
    duration: durationDays,
    accounts: resolvedAccountCount,
    totalPrice: Number(totalPrice.toFixed(2)),
    currency: 'USD',
    roleCount,
    services: lineItems
  };
};

module.exports = {
  loadPricingContext,
  getServiceRegionalDailyPrices,
  getRegionalDailyPricesForServices,
  getPortalDailyFees,
  calculateEstimate
};
