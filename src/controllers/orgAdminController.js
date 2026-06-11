const AppError = require('../utils/AppError');
const orgAdminService = require('../services/orgAdminService');

const login = async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim();
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    const result = await orgAdminService.login({ email, username, password });

    res.status(200).json({
      success: true,
      admin: result.admin,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt
    });
  } catch (error) {
    next(error);
  }
};

const listResourceGroups = async (req, res, next) => {
  try {
    const resourceGroups = await orgAdminService.listResourceGroups();

    res.status(200).json({
      success: true,
      resourceGroups,
      count: resourceGroups.length
    });
  } catch (error) {
    next(error);
  }
};

const getResourceGroupDetail = async (req, res, next) => {
  try {
    const requestId = Number(req.params.requestId);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      throw new AppError('Request id must be a positive integer.', 400);
    }

    const detail = await orgAdminService.getResourceGroupDetail(requestId);

    res.status(200).json({
      success: true,
      ...detail
    });
  } catch (error) {
    next(error);
  }
};

const getMonitoringLogs = async (req, res, next) => {
  try {
    const requestId = Number(req.params.requestId);
    const userId = req.query.userId ? Number(req.query.userId) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    if (!Number.isInteger(requestId) || requestId <= 0) {
      throw new AppError('Request id must be a positive integer.', 400);
    }

    const logs = await orgAdminService.getMonitoringLogs(requestId, { userId, limit });

    res.status(200).json({
      success: true,
      requestId,
      ...logs
    });
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const requestId = Number(req.params.requestId);
    const userId = Number(req.params.userId);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      throw new AppError('Request id must be a positive integer.', 400);
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new AppError('User id must be a positive integer.', 400);
    }

    const result = await orgAdminService.deleteUser({
      adminEmail: req.orgAdmin.email,
      requestId,
      userId
    });

    res.status(200).json({
      success: true,
      user: result
    });
  } catch (error) {
    next(error);
  }
};

const updateUserRoles = async (req, res, next) => {
  try {
    const requestId = Number(req.params.requestId);
    const userId = Number(req.params.userId);
    const roles = req.body?.roles;

    if (!Number.isInteger(requestId) || requestId <= 0) {
      throw new AppError('Request id must be a positive integer.', 400);
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new AppError('User id must be a positive integer.', 400);
    }

    const result = await orgAdminService.updateUserRoles({
      adminEmail: req.orgAdmin.email,
      requestId,
      userId,
      roles
    });

    res.status(200).json({
      success: true,
      user: result
    });
  } catch (error) {
    next(error);
  }
};

const forceLogoutUser = async (req, res, next) => {
  try {
    const requestId = Number(req.params.requestId);
    const userId = Number(req.params.userId);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      throw new AppError('Request id must be a positive integer.', 400);
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new AppError('User id must be a positive integer.', 400);
    }

    const result = await orgAdminService.forceLogoutUser({ requestId, userId });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

const listAccessRequests = async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status).trim() : undefined;
    const requestId = req.query.requestId ? Number(req.query.requestId) : undefined;

    const requests = await orgAdminService.listAccessRequests({ status, requestId });

    res.status(200).json({
      success: true,
      requests,
      count: requests.length
    });
  } catch (error) {
    next(error);
  }
};

const reviewAccessRequest = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const status = req.body?.status;
    const reviewNotes = req.body?.reviewNotes;

    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError('Access request id must be a positive integer.', 400);
    }

    const result = await orgAdminService.reviewAccessRequest({
      id,
      status,
      reviewNotes,
      reviewedBy: req.orgAdmin.email
    });

    res.status(200).json({
      success: true,
      request: result
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  login,
  listResourceGroups,
  getResourceGroupDetail,
  getMonitoringLogs,
  deleteUser,
  updateUserRoles,
  forceLogoutUser,
  listAccessRequests,
  reviewAccessRequest
};
