const AppError = require('../utils/AppError');
const provisionService = require('../services/provisionService');

const validateRequestId = (requestId) => {
  if (!/^\d+$/.test(requestId)) {
    throw new AppError('Request id must be a positive integer.', 400);
  }
};

const provisionRequestResourceGroup = async (req, res, next) => {
  try {
    validateRequestId(req.params.id);

    const result = await provisionService.provisionRequestResourceGroup(Number(req.params.id));

    res.status(200).json({
      success: true,
      resourceGroup: result.resourceGroup
    });
  } catch (error) {
    next(error);
  }
};

const getProvisionedRequest = async (req, res, next) => {
  try {
    validateRequestId(req.params.id);

    const request = await provisionService.getProvisionedRequest(Number(req.params.id));

    if (!request) {
      throw new AppError('Request not found.', 404);
    }

    res.status(200).json({
      success: true,
      status: request.status,
      resourceGroup: request.resourceGroup
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProvisionedRequest,
  provisionRequestResourceGroup
};
