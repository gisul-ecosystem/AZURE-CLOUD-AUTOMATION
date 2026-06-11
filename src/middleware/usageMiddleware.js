const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const usageMiddlewareHelper = require('../services/usageMiddlewareHelper');

const validateDailyUsage = async (req, res, next) => {
  try {
    const requestId = Number(req.body.requestId || req.params.requestId || req.query.requestId);
    const userId = Number(req.body.userId || req.params.userId || req.query.userId);

    if (!requestId || !Number.isInteger(requestId) || requestId <= 0) {
      return next(new AppError('Valid requestId is required for usage validation.', 400));
    }

    if (!userId || !Number.isInteger(userId) || userId <= 0) {
      return next(new AppError('Valid userId is required for usage validation.', 400));
    }

    const { access } = await usageMiddlewareHelper.evaluateRequestUserAccess({ requestId, userId });

    req.usageInfo = {
      requestId,
      userId,
      dailyUsageEnabled: access.dailyUsageEnabled !== false,
      usedMinutes: access.usedMinutes || 0,
      storedUsedMinutes: access.storedUsedMinutes || 0,
      currentSessionMinutes: access.currentSessionMinutes || 0,
      limitMinutes: access.limitMinutes,
      remainingMinutes: access.remainingMinutes,
      withinWindow: access.withinWindow,
      scheduleSummary: access.scheduleSummary,
      blocked: false
    };

    next();
  } catch (error) {
    next(error);
  }
};

const validateUserAccess = async (req, res, next) => {
  try {
    const requestId = Number(req.body.requestId || req.params.requestId || req.query.requestId || req.params.id);
    const userId = Number(req.body.userId || req.params.userId || req.query.userId);

    if (!requestId || !Number.isInteger(requestId) || requestId <= 0) {
      return next(new AppError('Valid requestId is required for access validation.', 400));
    }

    if (!userId || !Number.isInteger(userId) || userId <= 0) {
      req.accessInfo = {
        requestId,
        userId: null,
        adminAccess: true,
        accessGranted: true
      };
      return next();
    }

    const lookup = await db.query(
      `
      SELECT r.id as request_id, au.id as user_id
      FROM requests r
      LEFT JOIN azure_users au ON au.request_id = r.id AND au.id = $2
      WHERE r.id = $1
      `,
      [requestId, userId]
    );

    if (lookup.rows.length === 0) {
      return next();
    }

    if (!lookup.rows[0].user_id) {
      req.accessInfo = {
        requestId,
        userId,
        userNotProvisioned: true,
        accessGranted: true
      };
      return next();
    }

    const { access } = await usageMiddlewareHelper.evaluateRequestUserAccess({
      requestId,
      userId,
      enforceOnDeny: true
    });

    req.accessInfo = {
      requestId,
      userId,
      dailyUsageEnabled: access.dailyUsageEnabled !== false,
      usedMinutes: access.usedMinutes || 0,
      limitMinutes: access.limitMinutes,
      remainingMinutes: access.remainingMinutes,
      withinWindow: access.withinWindow,
      scheduleSummary: access.scheduleSummary,
      blocked: false,
      accessGranted: true
    };

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  validateDailyUsage,
  validateUserAccess
};
