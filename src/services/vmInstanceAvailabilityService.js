const { ComputeManagementClient } = require('@azure/arm-compute');
const { createAzureCredential, validateAzureEnv } = require('../config/azure');
const {
  isVirtualMachineService,
  normalizeVmSize,
  getVmSizeFallbackChain
} = require('../utils/vmSize');
const AppError = require('../utils/AppError');

const CACHE_TTL_MS = 5 * 60 * 1000;
const sizeCache = new Map();

const isSkuRestrictedInLocation = (sku, location) =>
  (sku.restrictions || []).some((restriction) => {
    const restrictedLocations = [
      ...(restriction.restrictionInfo?.locations || []),
      ...(restriction.values || [])
    ];

    return restrictedLocations.some(
      (restrictedLocation) => String(restrictedLocation).trim().toLowerCase() === location
    );
  });

const getDeployableVmSizesForLocation = async (location) => {
  const normalizedLocation = String(location || '').trim().toLowerCase();

  if (!normalizedLocation) {
    return new Set();
  }

  const cached = sizeCache.get(normalizedLocation);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.sizes;
  }

  const azureConfig = validateAzureEnv();
  const client = new ComputeManagementClient(
    createAzureCredential(azureConfig),
    azureConfig.subscriptionId
  );

  const sizes = new Set();

  for await (const sku of client.resourceSkus.list({
    filter: `location eq '${normalizedLocation}'`
  })) {
    if (sku.resourceType !== 'virtualMachines' || !sku.name) {
      continue;
    }

    const isListedForLocation = (sku.locations || []).some(
      (listedLocation) => String(listedLocation).trim().toLowerCase() === normalizedLocation
    );

    if (!isListedForLocation || isSkuRestrictedInLocation(sku, normalizedLocation)) {
      continue;
    }

    sizes.add(sku.name);
  }

  sizeCache.set(normalizedLocation, {
    sizes,
    expiresAt: Date.now() + CACHE_TTL_MS
  });

  return sizes;
};

const resolveVmSizeForLocation = async (location, instanceOption) => {
  const normalizedLocation = String(location || '').trim().toLowerCase();
  const candidates = getVmSizeFallbackChain(instanceOption);
  const deployableSizes = await getDeployableVmSizesForLocation(normalizedLocation);

  for (const candidate of candidates) {
    if (deployableSizes.has(candidate)) {
      return candidate;
    }
  }

  const requestedSize = normalizeVmSize(instanceOption);
  const sampleSizes = [...deployableSizes]
    .filter((name) => /^Standard_B/i.test(name))
    .slice(0, 5)
    .join(', ');

  throw new AppError(
    `VM size ${requestedSize} is not available in ${normalizedLocation}.` +
      (sampleSizes ? ` Try one of: ${sampleSizes}.` : ' Choose another size or region.'),
    400
  );
};

const assertVmSizeAvailableInLocation = async (location, instanceOption) =>
  resolveVmSizeForLocation(location, instanceOption);

const filterVmInstancesForLocation = async (location, instances, servicesById) => {
  const normalizedLocation = String(location || '').trim().toLowerCase();

  if (!normalizedLocation || instances.length === 0) {
    return instances;
  }

  const hasVmInstances = instances.some((instance) => {
    const service = servicesById.get(Number(instance.serviceId ?? instance.service_id));
    return isVirtualMachineService(service?.name);
  });

  if (!hasVmInstances) {
    return instances;
  }

  const deployableSizes = await getDeployableVmSizesForLocation(normalizedLocation);

  return instances.filter((instance) => {
    const serviceId = Number(instance.serviceId ?? instance.service_id);
    const service = servicesById.get(serviceId);

    if (!isVirtualMachineService(service?.name)) {
      return true;
    }

    const candidates = getVmSizeFallbackChain(instance.option_name);
    return candidates.some((candidate) => deployableSizes.has(candidate));
  });
};

module.exports = {
  getDeployableVmSizesForLocation,
  resolveVmSizeForLocation,
  assertVmSizeAvailableInLocation,
  filterVmInstancesForLocation
};
