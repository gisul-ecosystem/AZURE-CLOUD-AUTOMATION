const AppError = require('../utils/AppError');
const cleanupService = require('../services/cleanupService');

const validateRequestId = (requestId) => {
  if (!/^\d+$/.test(requestId)) {
    throw new AppError('Request id must be a positive integer.', 400);
  }
};

const cleanupRequest = async (req, res, next) => {
  try {
    validateRequestId(req.params.id);

    const result = await cleanupService.cleanupRequestById(Number(req.params.id), 'manual');

    res.status(200).json({
      success: true,
      expired: result.expired,
      cleanupCompleted: result.cleanupCompleted,
      resourceGroup: result.resourceGroup
    });
  } catch (error) {
    next(error);
  }
};

const getCleanupStatus = async (req, res, next) => {
  try {
    validateRequestId(req.params.id);

    const result = await cleanupService.getCleanupStatus(Number(req.params.id));

    if (!result) {
      throw new AppError('Request not found.', 404);
    }

    res.status(200).json({
      success: true,
      status: result.status,
      resourceGroup: result.resourceGroup,
      expired: result.expired,
      cleanupCompleted: result.cleanupCompleted
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  cleanupRequest,
  getCleanupStatus
};
