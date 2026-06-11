const AppError = require('../utils/AppError');
const pricingService = require('../services/pricingService');
const { lookupAzureRetailPrice } = require('../services/azurePricingService');
const { parseFlexibleDateTime } = require('../utils/dateTime');

const allowedPricingFields = new Set([
  'accountCount',
  'serviceIds',
  'location',
  'startDate',
  'endDate',
  'selectedInstances',
  'selectedRoles'
]);
const allowedRetailPricingQueryParams = new Set(['service', 'region', 'sku']);
const DEFAULT_LOCATION = 'eastus';
const DEFAULT_START_DATE = () => new Date().toISOString().slice(0, 10);
const DEFAULT_END_DATE = () => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

const validatePricingPayload = (body) => {
  const invalidFields = Object.keys(body).filter((field) => !allowedPricingFields.has(field));
  const { accountCount, serviceIds, location, startDate, endDate } = body;
  const missingFields = ['accountCount', 'serviceIds', 'startDate', 'endDate'].filter(
    (field) => body[field] === undefined || body[field] === null || body[field] === ''
  );

  if (invalidFields.length > 0) {
    throw new AppError(`Invalid field(s): ${invalidFields.join(', ')}`, 400);
  }

  if (missingFields.length > 0) {
    throw new AppError(`Missing required field(s): ${missingFields.join(', ')}`, 400);
  }

  if (!Number.isInteger(accountCount) || accountCount <= 0) {
    throw new AppError('accountCount must be a positive integer.', 400);
  }

  if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
    throw new AppError('serviceIds must be a non-empty array.', 400);
  }

  if (location !== undefined && (typeof location !== 'string' || location.trim().length === 0)) {
    throw new AppError('location must be a non-empty string when provided.', 400);
  }

  if (startDate !== undefined && parseFlexibleDateTime(startDate) === null) {
    throw new AppError('startDate must be a valid date or date-time string when provided.', 400);
  }

  if (endDate !== undefined && parseFlexibleDateTime(endDate) === null) {
    throw new AppError('endDate must be a valid date or date-time string when provided.', 400);
  }

  const invalidServiceId = serviceIds.some((serviceId) => !Number.isInteger(serviceId) || serviceId <= 0);

  if (invalidServiceId) {
    throw new AppError('serviceIds must contain only positive integers.', 400);
  }

  if (new Set(serviceIds).size !== serviceIds.length) {
    throw new AppError('serviceIds must not contain duplicates.', 400);
  }
};

const validateRetailPricingQuery = (query) => {
  const invalidFields = Object.keys(query).filter((field) => !allowedRetailPricingQueryParams.has(field));

  if (invalidFields.length > 0) {
    throw new AppError(`Invalid query parameter(s): ${invalidFields.join(', ')}`, 400);
  }

  if (typeof query.service !== 'string' || query.service.trim().length === 0) {
    throw new AppError('service must be a non-empty string.', 400);
  }

  if (typeof query.region !== 'string' || query.region.trim().length === 0) {
    throw new AppError('region must be a non-empty string.', 400);
  }

  if (query.sku !== undefined && typeof query.sku !== 'string') {
    throw new AppError('sku must be a string when provided.', 400);
  }
};

const calculatePricing = async (req, res, next) => {
  try {
    console.log(
      JSON.stringify({
        event: 'pricing_request',
        body: req.body,
        timestamp: new Date().toISOString()
      })
    );

    validatePricingPayload(req.body);

    const payload = {
      accountCount: Number(req.body.accountCount),
      serviceIds: req.body.serviceIds.map(Number),
      location: String(req.body.location || DEFAULT_LOCATION),
      startDate: String(req.body.startDate || DEFAULT_START_DATE()),
      endDate: String(req.body.endDate || DEFAULT_END_DATE()),
      selectedInstances: Array.isArray(req.body.selectedInstances) ? req.body.selectedInstances : [],
      selectedRoles: Array.isArray(req.body.selectedRoles) ? req.body.selectedRoles : []
    };

    console.log(
      JSON.stringify({
        event: 'duration_validation_started',
        timestamp: new Date().toISOString(),
        startDate: payload.startDate,
        endDate: payload.endDate
      })
    );

    const startDate = parseFlexibleDateTime(payload.startDate);
    const endDate = parseFlexibleDateTime(payload.endDate);

    if (!startDate || !endDate || endDate < startDate) {
      throw new AppError('endDate must be on or after startDate', 400);
    }

    console.log(
      JSON.stringify({
        event: 'duration_validation_completed',
        timestamp: new Date().toISOString(),
        startDate: payload.startDate,
        endDate: payload.endDate
      })
    );

    console.log(
      JSON.stringify({
        event: 'pricing_request_received',
        timestamp: new Date().toISOString(),
        accountCount: payload.accountCount,
        serviceIds: payload.serviceIds,
        location: payload.location,
        startDate: payload.startDate,
        endDate: payload.endDate
      })
    );

    const pricing = await pricingService.calculatePricing(payload);

    res.status(200).json(pricing);
  } catch (error) {
    next(error);
  }
};

const getRetailPricing = async (req, res, next) => {
  try {
    validateRetailPricingQuery(req.query);

    const pricing = await lookupAzureRetailPrice({
      service: req.query.service,
      region: req.query.region,
      sku: req.query.sku
    });

    res.status(200).json(pricing);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  calculatePricing,
  getRetailPricing
};
