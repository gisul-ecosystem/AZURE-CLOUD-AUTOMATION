const AppError = require('../utils/AppError');
const adminAuthService = require('../services/adminAuthService');

const getSessionToken = (req) => {
  const querySession = typeof req.query.session === 'string' ? req.query.session.trim() : '';
  const headerSession =
    typeof req.headers['x-org-admin-session'] === 'string'
      ? req.headers['x-org-admin-session'].trim()
      : '';
  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
  const bearerSession = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';

  return querySession || headerSession || bearerSession;
};

const authenticateOrgAdmin = async (req, res, next) => {
  try {
    const sessionToken = getSessionToken(req);

    if (!sessionToken) {
      throw new AppError('Organization admin session is required.', 401);
    }

    const session = await adminAuthService.requireOrgAdminSession(sessionToken);

    req.orgAdmin = {
      sessionToken,
      adminId: session.admin_id,
      email: session.email,
      username: session.username
    };

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  authenticateOrgAdmin,
  getSessionToken
};
