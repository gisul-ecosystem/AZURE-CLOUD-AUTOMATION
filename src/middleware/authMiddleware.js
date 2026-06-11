const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const usageService = require('../services/usageService');
const { evaluateRequestUserAccess } = require('../services/usageMiddlewareHelper');

async function authenticatePortalAccess(req, res, next) {
  try {
    const sessionToken = req.query.session || req.headers['x-session-token'];

    if (!sessionToken) {
      throw new AppError('Session token is required.', 401);
    }

    const sessionResult = await db.query(
      `
      SELECT
        aps.request_id,
        aps.user_id,
        aps.created_at,
        aps.expires_at,
        r.enable_daily_usage,
        r.daily_limit_minutes,
        r.usage_schedule,
        r.status as request_status,
        r.expiry_date,
        au.blocked_until,
        au.used_today_minutes
      FROM access_portal_sessions aps
      JOIN requests r ON r.id = aps.request_id
      LEFT JOIN azure_users au ON au.id = aps.user_id AND au.request_id = aps.request_id
      WHERE aps.session_token = $1
      `,
      [sessionToken]
    );

    if (sessionResult.rows.length === 0) {
      throw new AppError('Invalid or expired session token.', 401);
    }

    const session = sessionResult.rows[0];

    if (session.expires_at) {
      const now = new Date();
      const expiresAt = new Date(session.expires_at);
      if (now > expiresAt) {
        console.log(`[AUTH] Portal session expired for token: ${sessionToken.substring(0, 8)}...`);
        throw new AppError('Portal session has expired.', 401);
      }
    }

    if (session.request_status === 'Cancelled' || session.request_status === 'Expired') {
      console.log(`[AUTH] Request ${session.request_id} is ${session.request_status}`);
      throw new AppError(`Request is ${session.request_status}.`, 403);
    }

    if (session.expiry_date) {
      const now = new Date();
      const expiryDate = new Date(session.expiry_date);
      if (now > expiryDate) {
        console.log(`[AUTH] Request ${session.request_id} expired on ${expiryDate.toISOString()}`);
        throw new AppError('Access has expired.', 403);
      }
    }

    if (session.enable_daily_usage && session.user_id) {
      const { access } = await evaluateRequestUserAccess({
        requestId: session.request_id,
        userId: session.user_id,
        enforceOnDeny: true
      });

      const activeSessionResult = await db.query(
        `
        SELECT id
        FROM user_usage_sessions
        WHERE request_id = $1
          AND user_id = $2
          AND logout_at IS NULL
        LIMIT 1
        `,
        [session.request_id, session.user_id]
      );

      if (activeSessionResult.rows.length === 0) {
        console.log(`[AUTH] Auto-starting usage session for user ${session.user_id}, request ${session.request_id}`);
        try {
          await usageService.startUsageSession({
            requestId: session.request_id,
            userId: session.user_id
          });
          console.log(`[AUTH] Usage session auto-started for user ${session.user_id}`);
        } catch (sessionError) {
          console.error('[AUTH] Failed to auto-start session:', sessionError.message);
        }
      }

      req.portalSession = {
        sessionToken,
        requestId: session.request_id,
        userId: session.user_id,
        enableDailyUsage: session.enable_daily_usage,
        dailyLimitMinutes: access.limitMinutes,
        scheduleSummary: access.scheduleSummary
      };

      return next();
    }

    req.portalSession = {
      sessionToken,
      requestId: session.request_id,
      userId: session.user_id,
      enableDailyUsage: session.enable_daily_usage,
      dailyLimitMinutes: session.daily_limit_minutes
    };

    next();
  } catch (error) {
    next(error);
  }
}

async function checkLoginAllowed(req, res, next) {
  try {
    const { requestId, userId } = req.body || req.params;

    if (!requestId || !userId) {
      return next();
    }

    await evaluateRequestUserAccess({
      requestId: Number(requestId),
      userId: Number(userId),
      enforceOnDeny: true
    });

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  authenticatePortalAccess,
  checkLoginAllowed
};
