const AppError = require('../utils/AppError');
const roleProvisionService = require('../services/roleProvisionService');

const validateRequestId = (requestId) => {
  if (!/^\d+$/.test(requestId)) {
    throw new AppError('Request id must be a positive integer.', 400);
  }
};

const provisionRolesForRequest = async (req, res, next) => {
  try {
    validateRequestId(req.params.id);

    const result = await roleProvisionService.provisionRolesForRequest(Number(req.params.id));

    res.status(200).json({
      success: true,
      usersProcessed: result.usersProcessed,
      rolesAssigned: result.rolesAssigned
    });
  } catch (error) {
    next(error);
  }
};

const getRoleAssignmentsForRequest = async (req, res, next) => {
  try {
    validateRequestId(req.params.id);

    const roles = await roleProvisionService.getUserRoleAssignmentsForRequest(Number(req.params.id));

    res.status(200).json({
      success: true,
      roles
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getRoleAssignmentsForRequest,
  provisionRolesForRequest
};
