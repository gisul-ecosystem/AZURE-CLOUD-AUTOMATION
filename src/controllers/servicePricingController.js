const AppError = require('../utils/AppError');
const servicePricingService = require('../services/servicePricingService');

const allowedQueryParams = new Set(['location']);
const DEFAULT_LOCATION = 'eastus';

const validateQueryParams = (query) => {
  const invalidQueryParams = Object.keys(query).filter((key) => !allowedQueryParams.has(key));

  if (invalidQueryParams.length > 0) {
    throw new AppError(`Invalid query parameter(s): ${invalidQueryParams.join(', ')}`, 400);
  }

  if (query.location !== undefined && (typeof query.location !== 'string' || query.location.trim().length === 0)) {
    throw new AppError('location must be a non-empty string when provided.', 400);
  }
};

const getServicePricing = async (req, res, next) => {
  try {
    validateQueryParams(req.query);

    const location = String(req.query.location || DEFAULT_LOCATION);
    const services = await servicePricingService.getServicesWithPricing(location);

    res.status(200).json({
      success: true,
      location: location.trim().toLowerCase(),
      priceModel: 'hourly',
      services
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getServicePricing
};
