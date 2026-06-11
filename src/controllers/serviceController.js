const serviceService = require('../services/serviceService');
const AppError = require('../utils/AppError');
const apiResponse = require('../utils/apiResponse');

const allowedQueryParams = new Set(['category', 'location']);
const allowedPricingQueryParams = new Set(['location']);
const allowedAvailableLocationsQueryParams = new Set(['serviceIds', 'instanceSelections']);
const allowedAvailableInstancesQueryParams = new Set(['location', 'serviceIds']);

const validateQueryParams = (query) => {
  const queryKeys = Object.keys(query);
  const invalidQueryParams = queryKeys.filter((key) => !allowedQueryParams.has(key));

  if (invalidQueryParams.length > 0) {
    throw new AppError(`Invalid query parameter(s): ${invalidQueryParams.join(', ')}`, 400);
  }

  if (query.category !== undefined) {
    if (typeof query.category !== 'string' || query.category.trim().length === 0) {
      throw new AppError('The category query parameter must be a non-empty string.', 400);
    }
  }

  if (query.location !== undefined) {
    if (typeof query.location !== 'string' || query.location.trim().length === 0) {
      throw new AppError('The location query parameter must be a non-empty string.', 400);
    }
  }
};

const getServices = async (req, res, next) => {
  try {
    validateQueryParams(req.query);

    const category = req.query.category ? req.query.category.trim() : undefined;
    const location = req.query.location ? String(req.query.location).trim().toLowerCase() : undefined;
    const hasFilters = Boolean(category || location);

    console.log(
      JSON.stringify({
        event: 'services_fetch_started',
        category,
        location,
        timestamp: new Date().toISOString()
      })
    );

    if (!hasFilters) {
      const bundle = await serviceService.getServiceBundle();

      res.status(200).json({
        success: true,
        categories: bundle.categories,
        services: bundle.services,
        roles: bundle.roles,
        regions: bundle.regions,
        instances: bundle.instances,
        instanceRoleMappings: bundle.instanceRoleMappings || [],
        count: bundle.services.length
      });
      return;
    }

    const services = await serviceService.getActiveServices(category, location);

    res.status(200).json(
      apiResponse({
        data: services,
        count: services.length
      })
    );
  } catch (error) {
    next(error);
  }
};

const validatePricingQueryParams = (query) => {
  const queryKeys = Object.keys(query);
  const invalidQueryParams = queryKeys.filter((key) => !allowedPricingQueryParams.has(key));

  if (invalidQueryParams.length > 0) {
    throw new AppError(`Invalid query parameter(s): ${invalidQueryParams.join(', ')}`, 400);
  }

  if (query.location !== undefined) {
    if (typeof query.location !== 'string' || query.location.trim().length === 0) {
      throw new AppError('The location query parameter must be a non-empty string.', 400);
    }
  }
};

const getServicePricing = async (req, res, next) => {
  try {
    validatePricingQueryParams(req.query);

    const location = req.query.location ? req.query.location.trim() : undefined;
    const services = await serviceService.getActiveServicesWithPricing(location);

    res.status(200).json({
      services
    });
  } catch (error) {
    next(error);
  }
};

const getCatalogServices = async (req, res, next) => {
  try {
    if (Object.keys(req.query).length > 0) {
      throw new AppError('The /api/services/catalog endpoint does not accept query parameters.', 400);
    }

    const services = await serviceService.getServiceCatalog();

    console.log(
      JSON.stringify({
        event: 'catalog_loaded',
        count: services.length,
        firstService: services[0]?.name || services[0]?.service_name || null,
        timestamp: new Date().toISOString()
      })
    );

    res.status(200).json({
      success: true,
      services
    });
  } catch (error) {
    next(error);
  }
};

const getLocations = async (req, res, next) => {
  try {
    if (Object.keys(req.query).length > 0) {
      throw new AppError('The /api/locations endpoint does not accept query parameters.', 400);
    }

    const locations = await serviceService.getDistinctLocations();

    res.status(200).json(
      apiResponse({
        data: locations,
        count: locations.length
      })
    );
  } catch (error) {
    next(error);
  }
};

const normalizeServiceIds = (value) => {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const serviceIds = rawValues
    .map((serviceId) => Number(String(serviceId).trim()))
    .filter((serviceId) => Number.isInteger(serviceId) && serviceId > 0);

  if (serviceIds.length === 0) {
    throw new AppError('serviceIds must be a non-empty array of positive integers.', 400);
  }

  if (new Set(serviceIds).size !== serviceIds.length) {
    throw new AppError('serviceIds must not contain duplicates.', 400);
  }

  return serviceIds;
};

const getAvailableLocations = async (req, res, next) => {
  try {
    const queryKeys = Object.keys(req.query);
    const invalidQueryParams = queryKeys.filter((key) => !allowedAvailableLocationsQueryParams.has(key));

    if (invalidQueryParams.length > 0) {
      throw new AppError(`Invalid query parameter(s): ${invalidQueryParams.join(', ')}`, 400);
    }

    const rawServiceIds = req.body?.serviceIds ?? req.query.serviceIds;
    const serviceIds = normalizeServiceIds(rawServiceIds);
    const instanceSelections =
      req.body?.selectedInstances ?? req.body?.instanceSelections ?? req.query.instanceSelections;
    const locations = await serviceService.getAvailableLocations(serviceIds, instanceSelections);

    res.status(200).json({
      success: true,
      locations
    });
  } catch (error) {
    next(error);
  }
};

const getAvailableInstances = async (req, res, next) => {
  try {
    const queryKeys = Object.keys(req.query);
    const invalidQueryParams = queryKeys.filter((key) => !allowedAvailableInstancesQueryParams.has(key));

    if (invalidQueryParams.length > 0) {
      throw new AppError(`Invalid query parameter(s): ${invalidQueryParams.join(', ')}`, 400);
    }

    const location = req.query.location ? String(req.query.location).trim() : '';
    if (!location) {
      throw new AppError('location is required.', 400);
    }

    const serviceIds = normalizeServiceIds(req.query.serviceIds);
    const instances = await serviceService.getAvailableInstances(location, serviceIds);

    res.status(200).json({
      success: true,
      location,
      instances,
      count: instances.length
    });
  } catch (error) {
    next(error);
  }
};

const getServiceRoles = async (req, res, next) => {
  try {
    const serviceId = Number(req.params.serviceId);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      throw new AppError('serviceId must be a positive integer.', 400);
    }

    const roles = await serviceService.getServiceRoles(serviceId);

    res.status(200).json({
      success: true,
      roles
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getServices,
  getServicePricing,
  getCatalogServices,
  getLocations,
  getAvailableLocations,
  getAvailableInstances,
  getServiceRoles
};
