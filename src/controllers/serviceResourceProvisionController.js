const AppError = require('../utils/AppError');
const serviceResourceProvisionService = require('../services/serviceResourceProvisionService');

const validateRequestId = (requestId) => {
  if (!/^\d+$/.test(requestId)) {
    throw new AppError('Request id must be a positive integer.', 400);
  }
};

const provisionServiceResources = async (req, res, next) => {
  try {
    validateRequestId(req.params.id);

    const result = await serviceResourceProvisionService.provisionServiceResourcesForRequest(
      Number(req.params.id)
    );

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
};

const getProvisionedServiceResources = async (req, res, next) => {
  try {
    validateRequestId(req.params.id);

    const resources = await serviceResourceProvisionService.getProvisionedResourcesForRequest(
      Number(req.params.id)
    );

    res.status(200).json({
      success: true,
      resources,
      count: resources.length
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  provisionServiceResources,
  getProvisionedServiceResources
};
