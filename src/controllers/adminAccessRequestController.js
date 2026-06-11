const AppError = require('../utils/AppError');
const adminAccessRequestService = require('../services/adminAccessRequestService');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const createAdminAccessRequest = async (req, res, next) => {
  try {
    const customerEmail = String(req.body?.customerEmail || '').trim();

    if (!emailPattern.test(customerEmail)) {
      throw new AppError('customerEmail must be a valid email address.', 400);
    }

    const result = await adminAccessRequestService.createAdminAccessRequest({
      customerEmail,
      serviceId: req.body?.serviceId,
      serviceName: req.body?.serviceName,
      defaultRole: req.body?.defaultRole,
      requestedAccess: req.body?.requestedAccess,
      accountCount: req.body?.accountCount,
      requestId: req.body?.requestId
    });

    res.status(201).json({
      success: true,
      request: result
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createAdminAccessRequest
};
