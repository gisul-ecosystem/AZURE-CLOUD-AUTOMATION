const AppError = require('../utils/AppError');
const userProvisionService = require('../services/userProvisionService');

const validateRequestId = (requestId) => {
  if (!/^\d+$/.test(requestId)) {
    throw new AppError('Request id must be a positive integer.', 400);
  }
};

const provisionUsersForRequest = async (req, res, next) => {
  try {
    validateRequestId(req.params.id);

    const result = await userProvisionService.provisionUsersForRequest(Number(req.params.id));

    res.status(200).json({
      success: true,
      usersCreated: result.usersCreated
    });
  } catch (error) {
    next(error);
  }
};

const getUsersForRequest = async (req, res, next) => {
  try {
    validateRequestId(req.params.id);

    const users = await userProvisionService.getUsersForRequest(Number(req.params.id));

    res.status(200).json({
      success: true,
      users
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUsersForRequest,
  provisionUsersForRequest
};
