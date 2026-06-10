const AppError = require('../utils/AppError');
const managePortalService = require('../services/managePortalService');

const getSessionToken = (req) => {
  const querySession = typeof req.query.session === 'string' ? req.query.session.trim() : '';
  const headerSession = typeof req.headers['x-access-session'] === 'string' ? req.headers['x-access-session'].trim() : '';
  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
  const bearerSession = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';

  return querySession || headerSession || bearerSession;
};

const exchangeToken = async (req, res, next) => {
  try {
    const token = typeof req.query.token === 'string'
      ? req.query.token.trim()
      : String(req.body?.token || '').trim();
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!token) {
      throw new AppError('token is required.', 400);
    }

    const result = await managePortalService.exchangeAccessToken(token, {
      username,
      password
    });

    res.status(200).json({
      success: true,
      requestId: result.requestId,
      customerEmail: result.customerEmail,
      admin: result.admin,
      resourceGroup: result.resourceGroup,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      userId: result.userId
    });
  } catch (error) {
    next(error);
  }
};

const getRequest = async (req, res, next) => {
  try {
    const sessionToken = getSessionToken(req);
    const requestId = Number(req.params.requestId);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      throw new AppError('Request id must be a positive integer.', 400);
    }

    const result = await managePortalService.listPortalUsers(sessionToken, requestId);

    res.status(200).json({
      success: true,
      requestId: result.requestId,
      users: result.users
    });
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const sessionToken = getSessionToken(req);
    const requestId = Number(req.query.requestId || req.body?.requestId || 0);
    const userId = Number(req.params.userId);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      throw new AppError('requestId is required.', 400);
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new AppError('User id must be a positive integer.', 400);
    }

    const result = await managePortalService.deletePortalUser(sessionToken, requestId, userId);

    res.status(200).json({
      success: true,
      user: result
    });
  } catch (error) {
    next(error);
  }
};

const updateRoles = async (req, res, next) => {
  try {
    const sessionToken = getSessionToken(req);
    const requestId = Number(req.query.requestId || req.body?.requestId || 0);
    const userId = Number(req.params.userId);
    const roles = req.body?.roles;

    if (!Number.isInteger(requestId) || requestId <= 0) {
      throw new AppError('requestId is required.', 400);
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new AppError('User id must be a positive integer.', 400);
    }

    const result = await managePortalService.updatePortalUserRoles(sessionToken, requestId, userId, roles);

    res.status(200).json({
      success: true,
      user: result
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  deleteUser,
  exchangeToken,
  getRequest,
  updateRoles
};
