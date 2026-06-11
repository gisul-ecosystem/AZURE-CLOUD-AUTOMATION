const AppError = require('../utils/AppError');
const requestService = require('../services/requestService');
const { parseFlexibleDateTime } = require('../utils/dateTime');
const { validateUsageSchedule, getMaxDailyLimitMinutes } = require('../utils/usageSchedule');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const allowedRequestFields = new Set([
  'customerEmail',
  'accountCount',
  'location',
  'serviceIds',
  'selectedRoles',
  'selectedInstances',
  'provisionServiceIds',
  'startDate',
  'endDate',
  'enableDailyUsage',
  'dailyLimitMinutes',
  'usageSchedule'
]);

const validateRequestPayload = (body) => {
  const invalidFields = Object.keys(body).filter((field) => !allowedRequestFields.has(field));
  const {
    customerEmail,
    accountCount,
    location,
    serviceIds,
    selectedRoles,
    selectedInstances,
    provisionServiceIds,
    startDate,
    endDate,
    enableDailyUsage,
    dailyLimitMinutes,
    usageSchedule
  } = body;

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

  if (enableDailyUsage !== undefined && typeof enableDailyUsage !== 'boolean') {
    throw new AppError('enableDailyUsage must be a boolean when provided.', 400);
  }

  if (dailyLimitMinutes !== undefined) {
    if (!Number.isInteger(dailyLimitMinutes) || dailyLimitMinutes <= 0) {
      throw new AppError('dailyLimitMinutes must be a positive integer when provided.', 400);
    }
  }

  if (usageSchedule !== undefined) {
    if (!usageSchedule || typeof usageSchedule !== 'object') {
      throw new AppError('usageSchedule must be an object when provided.', 400);
    }

    const scheduleErrors = validateUsageSchedule(usageSchedule);
    if (scheduleErrors.length > 0) {
      throw new AppError(scheduleErrors.join(' '), 400);
    }
  }

  if (enableDailyUsage === true && !usageSchedule && !dailyLimitMinutes) {
    throw new AppError('usageSchedule or dailyLimitMinutes is required when enableDailyUsage is true.', 400);
  }

  const invalidServiceId = serviceIds.some((serviceId) => !Number.isInteger(serviceId) || serviceId <= 0);

  if (invalidServiceId) {
    throw new AppError('serviceIds must contain only positive integers.', 400);
  }

  if (new Set(serviceIds).size !== serviceIds.length) {
    throw new AppError('serviceIds must not contain duplicates.', 400);
  }

  if (!Array.isArray(selectedRoles) || selectedRoles.length === 0) {
    throw new AppError('selectedRoles must be a non-empty array.', 400);
  }

  for (const entry of selectedRoles) {
    if (!entry || typeof entry !== 'object') {
      throw new AppError('selectedRoles must contain service role objects.', 400);
    }

    if (!Number.isInteger(entry.serviceId) || entry.serviceId <= 0) {
      throw new AppError('selectedRoles.serviceId must be a positive integer.', 400);
    }

    if (!Array.isArray(entry.roles)) {
      throw new AppError('selectedRoles.roles must be an array.', 400);
    }

    const invalidRole = entry.roles.some((role) => typeof role !== 'string' || role.trim().length === 0);
    if (invalidRole) {
      throw new AppError('selectedRoles.roles must contain non-empty strings.', 400);
    }
  }

  if (selectedInstances !== undefined) {
    if (!Array.isArray(selectedInstances)) {
      throw new AppError('selectedInstances must be an array when provided.', 400);
    }

    for (const entry of selectedInstances) {
      if (!entry || typeof entry !== 'object') {
        throw new AppError('selectedInstances must contain instance objects.', 400);
      }

      if (!Number.isInteger(entry.serviceId) || entry.serviceId <= 0) {
        throw new AppError('selectedInstances.serviceId must be a positive integer.', 400);
      }

      if (typeof entry.instanceOption !== 'string' || entry.instanceOption.trim().length === 0) {
        throw new AppError('selectedInstances.instanceOption must be a non-empty string.', 400);
      }
    }
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
      selectedRoles: req.body.selectedRoles,
      selectedInstances: Array.isArray(req.body.selectedInstances) ? req.body.selectedInstances : [],
      provisionServiceIds: Array.isArray(req.body.provisionServiceIds)
        ? req.body.provisionServiceIds
        : undefined,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      enableDailyUsage: req.body.enableDailyUsage === true,
      dailyLimitMinutes: req.body.dailyLimitMinutes
        ? Number(req.body.dailyLimitMinutes)
        : req.body.usageSchedule
          ? getMaxDailyLimitMinutes(req.body.usageSchedule)
          : undefined,
      usageSchedule: req.body.usageSchedule || undefined
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
