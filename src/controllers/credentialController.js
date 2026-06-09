const AppError = require('../utils/AppError');
const credentialService = require('../services/credentialService');

const validateRequestId = (requestId) => {
  if (!/^\d+$/.test(requestId)) {
    throw new AppError('Request id must be a positive integer.', 400);
  }
};

const sendCredentials = async (req, res, next) => {
  try {
    validateRequestId(req.params.id);

    const result = await credentialService.sendCredentials(Number(req.params.id));

    res.status(200).json({
      success: true,
      requestId: result.requestId,
      portalLink: result.portalLink,
      usersSent: result.usersSent
    });
  } catch (error) {
    next(error);
  }
};

const getCredentialDelivery = async (req, res, next) => {
  try {
    validateRequestId(req.params.id);

    const delivery = await credentialService.getCredentialDelivery(Number(req.params.id));

    res.status(200).json({
      success: true,
      deliveryStatus: delivery ? delivery.deliveryStatus : null
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCredentialDelivery,
  sendCredentials,
  sendCredentialsForRequest: sendCredentials
};
