const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const usageService = require('../services/usageService');

/**
 * Middleware to authenticate portal access and auto-start usage session
 * Checks if user is blocked before allowing access
 * Automatically starts usage session on first portal access
 * 
 * Place this middleware on portal access routes that require user authentication
 */
async function authenticatePortalAccess(req, res, next) {
  try {
    // Extract session token from query params or headers
    const sessionToken = req.query.session || req.headers['x-session-token'];
    
    if (!sessionToken) {
      throw new AppError('Session token is required.', 401);
    }

    // Exchange session token for request and user info
    // This assumes access_portal_sessions table stores session -> requestId + userId mapping
    const sessionResult = await db.query(
      `
      SELECT 
        aps.request_id,
        aps.user_id,
        aps.created_at,
        aps.expires_at,
        r.enable_daily_usage,
        r.daily_limit_minutes,
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

    // Check if portal session has expired
    if (session.expires_at) {
      const now = new Date();
      const expiresAt = new Date(session.expires_at);
      if (now > expiresAt) {
        console.log(`[AUTH] Portal session expired for token: ${sessionToken.substring(0, 8)}...`);
        throw new AppError('Portal session has expired.', 401);
      }
    }

    // Check if request is still active
    if (session.request_status === 'Cancelled' || session.request_status === 'Expired') {
      console.log(`[AUTH] Request ${session.request_id} is ${session.request_status}`);
      throw new AppError(`Request is ${session.request_status}.`, 403);
    }

    // Check if request has expired
    if (session.expiry_date) {
      const now = new Date();
      const expiryDate = new Date(session.expiry_date);
      if (now > expiryDate) {
        console.log(`[AUTH] Request ${session.request_id} expired on ${expiryDate.toISOString()}`);
        throw new AppError('Access has expired.', 403);
      }
    }

    // If daily usage is enabled, check if user is blocked
    if (session.enable_daily_usage && session.user_id) {
      // Check if user is currently blocked
      if (session.blocked_until) {
        const now = new Date();
        const blockedUntil = new Date(session.blocked_until);
        if (now < blockedUntil) {
          console.log(`[AUTH] User ${session.user_id} is blocked until ${blockedUntil.toISOString()}`);
          throw new AppError(
            `Daily usage limit exceeded. Access is blocked until ${blockedUntil.toISOString()}. Please try again tomorrow.`,
            403
          );
        }
      }

      // Check if user has exceeded daily limit
      const usedMinutes = Number(session.used_today_minutes || 0);
      const limitMinutes = Number(session.daily_limit_minutes || 0);

      if (usedMinutes >= limitMinutes) {
        console.log(`[AUTH] User ${session.user_id} exceeded daily limit: ${usedMinutes}/${limitMinutes}`);
        throw new AppError(
          'Daily usage limit exceeded. Access is blocked until tomorrow.',
          403
        );
      }

      // Auto-start usage session if not already active
      // Check if there's an active session
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
        // No active session - auto-start one
        console.log(`[AUTH] Auto-starting usage session for user ${session.user_id}, request ${session.request_id}`);
        try {
          await usageService.startUsageSession({
            requestId: session.request_id,
            userId: session.user_id
          });
          console.log(`[AUTH] Usage session auto-started for user ${session.user_id}`);
        } catch (sessionError) {
          // Log error but don't block access if session start fails
          console.error(`[AUTH] Failed to auto-start session:`, sessionError.message);
        }
      }
    }

    // Attach session info to request for downstream use
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

/**
 * Middleware to check if user login is allowed (pre-login check)
 * Use this before credential delivery or portal token exchange
 */
async function checkLoginAllowed(req, res, next) {
  try {
    const { requestId, userId } = req.body || req.params;

    if (!requestId || !userId) {
      // If no user/request info, skip check (admin access)
      return next();
    }

    // Check if user is blocked
    const result = await db.query(
      `
      SELECT 
        au.blocked_until,
        au.used_today_minutes,
        r.enable_daily_usage,
        r.daily_limit_minutes,
        r.status as request_status,
        r.expiry_date
      FROM azure_users au
      JOIN requests r ON r.id = au.request_id
      WHERE au.id = $1 AND au.request_id = $2
      `,
      [userId, requestId]
    );

    if (result.rows.length === 0) {
      // User not found - let downstream handle
      return next();
    }

    const data = result.rows[0];

    // Check if request expired
    if (data.expiry_date) {
      const now = new Date();
      const expiryDate = new Date(data.expiry_date);
      if (now > expiryDate) {
        console.log(`[LOGIN_CHECK] Request ${requestId} expired`);
        throw new AppError('Access has expired.', 403);
      }
    }

    // Check if request is active
    if (data.request_status === 'Cancelled' || data.request_status === 'Expired') {
      console.log(`[LOGIN_CHECK] Request ${requestId} is ${data.request_status}`);
      throw new AppError('Request is no longer active.', 403);
    }

    // If daily usage is enabled, check block status
    if (data.enable_daily_usage) {
      if (data.blocked_until) {
        const now = new Date();
        const blockedUntil = new Date(data.blocked_until);
        if (now < blockedUntil) {
          console.log(`[LOGIN_CHECK] User ${userId} is blocked until ${blockedUntil.toISOString()}`);
          throw new AppError(
            `Daily usage limit reached. Access is blocked until ${blockedUntil.toISOString()}. Please try again tomorrow.`,
            403
          );
        }
      }

      // Check if limit exceeded
      const usedMinutes = Number(data.used_today_minutes || 0);
      const limitMinutes = Number(data.daily_limit_minutes || 0);

      if (usedMinutes >= limitMinutes) {
        console.log(`[LOGIN_CHECK] User ${userId} exceeded limit: ${usedMinutes}/${limitMinutes}`);
        throw new AppError('Daily usage limit exceeded. Access is blocked until tomorrow.', 403);
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  authenticatePortalAccess,
  checkLoginAllowed
};
