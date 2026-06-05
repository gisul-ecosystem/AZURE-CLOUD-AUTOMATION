const serviceService = require('../services/serviceService');
const AppError = require('../utils/AppError');
const apiResponse = require('../utils/apiResponse');

const allowedQueryParams = new Set(['category', 'location']);
const allowedPricingQueryParams = new Set(['location']);

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

    console.log(
      JSON.stringify({
        event: 'services_fetch_started',
        category,
        location,
        timestamp: new Date().toISOString()
      })
    );

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

module.exports = {
  getServices,
  getServicePricing,
  getLocations
};
