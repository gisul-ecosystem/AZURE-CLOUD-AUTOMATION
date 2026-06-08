const AppError = require('../utils/AppError');
const requestService = require('../services/requestService');
const { parseFlexibleDateTime } = require('../utils/dateTime');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const allowedRequestFields = new Set([
  'customerEmail',
  'accountCount',
  'location',
  'serviceIds',
  'provisionServiceIds',
  'startDate',
  'endDate'
]);

const validateRequestPayload = (body) => {
  const invalidFields = Object.keys(body).filter((field) => !allowedRequestFields.has(field));
  const { customerEmail, accountCount, location, serviceIds, provisionServiceIds, startDate, endDate } = body;

  if (invalidFields.length > 0) {
    throw new AppError(`Invalid field(s): ${invalidFields.join(', ')}`, 400);
  }

  if (typeof customerEmail !== 'string' || !emailPattern.test(customerEmail.trim())) {
    throw new AppError('customerEmail must be a valid email address.', 400);
  }

  if (!Number.isInteger(accountCount) || accountCount <= 0) {
    throw new AppError('accountCount must be a positive integer.', 400);
  }

  if (typeof location !== 'string' || location.trim().length === 0) {
    throw new AppError('location must be a non-empty string.', 400);
  }

  if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
    throw new AppError('serviceIds must be a non-empty array.', 400);
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

  if (provisionServiceIds !== undefined) {
    if (!Array.isArray(provisionServiceIds)) {
      throw new AppError('provisionServiceIds must be an array when provided.', 400);
    }

    const invalidProvisionServiceId = provisionServiceIds.some(
      (serviceId) => !Number.isInteger(serviceId) || serviceId <= 0
    );

    if (invalidProvisionServiceId) {
      throw new AppError('provisionServiceIds must contain only positive integers.', 400);
    }

    if (new Set(provisionServiceIds).size !== provisionServiceIds.length) {
      throw new AppError('provisionServiceIds must not contain duplicates.', 400);
    }
  }
};

const validateRequestId = (requestId) => {
  if (!/^\d+$/.test(requestId)) {
    throw new AppError('Request id must be a positive integer.', 400);
  }
};

const createRequest = async (req, res, next) => {
  try {
    validateRequestPayload(req.body);

    const payload = {
      customerEmail: req.body.customerEmail.trim(),
      accountCount: req.body.accountCount,
      location: req.body.location.trim(),
      serviceIds: req.body.serviceIds,
      provisionServiceIds: Array.isArray(req.body.provisionServiceIds)
        ? req.body.provisionServiceIds
        : undefined,
      startDate: req.body.startDate,
      endDate: req.body.endDate
    };

    const result = await requestService.createRequest(payload);

    res.status(201).json({
      success: true,
      requestId: result.requestId,
      estimatedPrice: result.estimatedPrice
    });
  } catch (error) {
    next(error);
  }
};

const getAllRequests = async (req, res, next) => {
  try {
    const requests = await requestService.getAllRequests();

    res.status(200).json({
      success: true,
      data: requests,
      count: requests.length
    });
  } catch (error) {
    next(error);
  }
};

const getRequestById = async (req, res, next) => {
  try {
    validateRequestId(req.params.id);

    const request = await requestService.getRequestById(Number(req.params.id));

    if (!request) {
      throw new AppError('Request not found.', 404);
    }

    res.status(200).json({
      success: true,
      data: request
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllRequests,
  createRequest,
  getRequestById
};
