const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const usageEnforcementService = require('../services/usageEnforcementService');

/**
 * Middleware to validate daily usage before allowing access
 * Usage: Add this middleware to protected routes that require usage validation
 * 
 * Expects req.body or req.params to contain: requestId, userId
 */
const validateDailyUsage = async (req, res, next) => {
  try {
    const requestId = Number(req.body.requestId || req.params.requestId || req.query.requestId);
    const userId = Number(req.body.userId || req.params.userId || req.query.userId);

    if (!requestId || !Number.isInteger(requestId) || requestId <= 0) {
      throw new AppError('Valid requestId is required for usage validation.', 400);
    }

    if (!userId || !Number.isInteger(userId) || userId <= 0) {
      throw new AppError('Valid userId is required for usage validation.', 400);
    }

    // Get request and user info
    const result = await db.query(
      `
      SELECT 
        r.id as request_id,
        r.enable_daily_usage,
        r.daily_limit_minutes,
        r.expiry_date,
        r.status as request_status,
        au.id as user_id,
        au.used_today_minutes,
        au.last_reset_date,
        au.blocked_until
      FROM requests r
      LEFT JOIN azure_users au ON au.request_id = r.id AND au.id = $2
      WHERE r.id = $1
      `,
      [requestId, userId]
    );

    if (result.rows.length === 0 || !result.rows[0].user_id) {
      throw new AppError('Request or user not found.', 404);
    }

    const data = result.rows[0];

    // Check if request is active
    if (data.request_status === 'Cancelled' || data.request_status === 'Expired') {
      throw new AppError('Request is no longer active.', 403);
    }

    // Check if request has expired
    if (data.expiry_date) {
      const now = new Date();
      const expiryDate = new Date(data.expiry_date);
      if (now > expiryDate) {
        throw new AppError('Access has expired.', 403);
      }
    }

    // If daily usage is not enabled, allow access
    if (!data.enable_daily_usage) {
      req.usageInfo = {
        requestId,
        userId,
        dailyUsageEnabled: false
      };
      return next();
    }

    // Daily usage is enabled - perform checks
    const today = new Date().toISOString().split('T')[0];
    const lastResetDate = data.last_reset_date
      ? new Date(data.last_reset_date).toISOString().split('T')[0]
      : null;

    // Reset counters if date has changed
    if (lastResetDate !== today) {
      await db.query(
        `
        UPDATE azure_users
        SET 
          used_today_minutes = 0,
          last_reset_date = CURRENT_DATE,
          blocked_until = NULL
        WHERE id = $1 AND request_id = $2
        `,
        [userId, requestId]
      );

      req.usageInfo = {
        requestId,
        userId,
        dailyUsageEnabled: true,
        usedMinutes: 0,
        limitMinutes: Number(data.daily_limit_minutes || 0),
        remainingMinutes: Number(data.daily_limit_minutes || 0),
        blocked: false
      };

      return next();
    }

    // Get active session for LIVE calculation
    const activeSessionResult = await db.query(
      `
      SELECT 
        FLOOR(EXTRACT(EPOCH FROM (NOW() - login_at)) / 60) as elapsed_minutes
      FROM user_usage_sessions
      WHERE request_id = $1 
        AND user_id = $2 
        AND logout_at IS NULL
      ORDER BY login_at DESC
      LIMIT 1
      `,
      [requestId, userId]
    );

    // Calculate LIVE usage
    const storedUsedMinutes = Number(data.used_today_minutes || 0);
    const currentSessionMinutes = activeSessionResult.rows.length > 0 
      ? Number(activeSessionResult.rows[0].elapsed_minutes || 0) 
      : 0;
    const usedMinutes = storedUsedMinutes + currentSessionMinutes;
    const limitMinutes = Number(data.daily_limit_minutes || 0);

    // Check if user is currently blocked
    if (data.blocked_until) {
      const now = new Date();
      const blockedUntil = new Date(data.blocked_until);
      if (now < blockedUntil) {
        throw new AppError(
          `Access is blocked until ${blockedUntil.toISOString()}. Daily usage limit exceeded.`,
          403
        );
      }
    }

    // Check if user has exceeded daily limit (including active session)
    if (usedMinutes >= limitMinutes) {
      throw new AppError(
        'Daily usage limit exceeded. Access is restricted until tomorrow.',
        403
      );
    }

    // All checks passed - allow access
    req.usageInfo = {
      requestId,
      userId,
      dailyUsageEnabled: true,
      usedMinutes,
      storedUsedMinutes,
      currentSessionMinutes,
      limitMinutes,
      remainingMinutes: limitMinutes - usedMinutes,
      blocked: false
    };

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Hard enforcement middleware - blocks access when daily limit reached
 * Usage: Add this middleware to protected routes (login, session start, credential access)
 * 
 * Expects req.body or req.params to contain: requestId, userId (userId is optional for some routes)
 */
const validateUserAccess = async (req, res, next) => {
  try {
    const requestId = Number(req.body.requestId || req.params.requestId || req.query.requestId || req.params.id);
    const userId = Number(req.body.userId || req.params.userId || req.query.userId);

    if (!requestId || !Number.isInteger(requestId) || requestId <= 0) {
      throw new AppError('Valid requestId is required for access validation.', 400);
    }

    // If no userId provided, skip user-specific validation (allow admin access)
    if (!userId || !Number.isInteger(userId) || userId <= 0) {
      console.log(`[ACCESS_CHECK] No userId provided for request ${requestId} - skipping user-specific validation`);
      req.accessInfo = {
        requestId,
        userId: null,
        adminAccess: true,
        accessGranted: true
      };
      return next();
    }

    // Load request and user info
    const result = await db.query(
      `
      SELECT 
        r.id as request_id,
        r.enable_daily_usage,
        r.daily_limit_minutes,
        r.expiry_date,
        r.status as request_status,
        r.enforce_in_azure,
        au.id as user_id,
        au.used_today_minutes,
        au.last_reset_date,
        au.blocked_until
      FROM requests r
      LEFT JOIN azure_users au ON au.request_id = r.id AND au.id = $2
      WHERE r.id = $1
      `,
      [requestId, userId]
    );

    if (result.rows.length === 0) {
      // Request not found, but let it through for proper error handling in controller
      console.log(`[ACCESS_CHECK] Request ${requestId} not found - allowing for proper error handling`);
      return next();
    }

    const data = result.rows[0];

    // If user not found in azure_users, allow (might be admin or provisioning not complete)
    if (!data.user_id) {
      console.log(`[ACCESS_CHECK] User ${userId} not found in azure_users for request ${requestId} - allowing access`);
      req.accessInfo = {
        requestId,
        userId,
        userNotProvisioned: true,
        accessGranted: true
      };
      return next();
    }

    // Check if request has expired
    if (data.expiry_date) {
      const now = new Date();
      const expiryDate = new Date(data.expiry_date);
      if (now > expiryDate) {
        console.log(`[LOGIN_BLOCKED] User ${userId} denied - request ${requestId} expired`);
        throw new AppError('Access has expired.', 403);
      }
    }

    // Check if request is active
    if (data.request_status === 'Cancelled' || data.request_status === 'Expired') {
      console.log(`[LOGIN_BLOCKED] User ${userId} denied - request ${requestId} status: ${data.request_status}`);
      throw new AppError('Request is no longer active.', 403);
    }

    // Check if user is currently blocked
    if (data.blocked_until) {
      const now = new Date();
      const blockedUntil = new Date(data.blocked_until);
      if (now < blockedUntil) {
        console.log(`[LOGIN_BLOCKED] User ${userId} denied - blocked until ${blockedUntil.toISOString()}`);
        throw new AppError(
          `Daily usage limit reached. Access is blocked until ${blockedUntil.toISOString()}. Please try again tomorrow.`,
          403
        );
      }
    }

    // If daily usage is not enabled, allow access
    if (!data.enable_daily_usage) {
      req.accessInfo = {
        requestId,
        userId,
        dailyUsageEnabled: false,
        accessGranted: true
      };
      return next();
    }

    // Daily usage is enabled - check if limit reached
    const today = new Date().toISOString().split('T')[0];
    const lastResetDate = data.last_reset_date
      ? new Date(data.last_reset_date).toISOString().split('T')[0]
      : null;

    // Reset counters if date has changed
    if (lastResetDate !== today) {
      console.log(`[USAGE_RESET] Resetting daily counters for user ${userId}`);
      await db.query(
        `
        UPDATE azure_users
        SET 
          used_today_minutes = 0,
          last_reset_date = CURRENT_DATE,
          blocked_until = NULL
        WHERE id = $1 AND request_id = $2
        `,
        [userId, requestId]
      );

      console.log(`[ACCESS_RESTORED] User ${userId} access restored after daily reset`);

      req.accessInfo = {
        requestId,
        userId,
        dailyUsageEnabled: true,
        usedMinutes: 0,
        limitMinutes: Number(data.daily_limit_minutes || 0),
        remainingMinutes: Number(data.daily_limit_minutes || 0),
        blocked: false,
        accessGranted: true
      };

      return next();
    }

    // Check if limit already reached (hard enforcement)
    const usedMinutes = Number(data.used_today_minutes || 0);
    const limitMinutes = Number(data.daily_limit_minutes || 0);

    if (usedMinutes >= limitMinutes) {
      console.log(`[LIMIT_REACHED] User ${userId} reached limit: ${usedMinutes}/${limitMinutes} minutes`);
      console.log(`[LOGIN_BLOCKED] User ${userId} denied - daily limit exceeded`);

      // Set blocked_until to tomorrow if not already set
      const blockResult = await db.query(
        `
        UPDATE azure_users
        SET blocked_until = DATE_TRUNC('day', NOW()) + INTERVAL '1 day'
        WHERE id = $1 AND request_id = $2 AND blocked_until IS NULL
        RETURNING blocked_until
        `,
        [userId, requestId]
      );

      const blockedUntil = blockResult.rows.length > 0 
        ? blockResult.rows[0].blocked_until 
        : new Date(new Date().setHours(24, 0, 0, 0));

      // Trigger Azure enforcement asynchronously if enabled
      if (data.enforce_in_azure) {
        usageEnforcementService
          .enforceUsageLimit({ requestId, userId })
          .catch((error) => {
            console.error('[LOGIN_BLOCKED] Error enforcing usage limit:', error);
          });
      }

      throw new AppError(
        `Daily usage limit reached (${usedMinutes}/${limitMinutes} minutes used). Access is blocked until ${new Date(blockedUntil).toISOString()}. Please try again tomorrow.`,
        403
      );
    }

    // Access granted
    req.accessInfo = {
      requestId,
      userId,
      dailyUsageEnabled: true,
      usedMinutes,
      limitMinutes,
      remainingMinutes: limitMinutes - usedMinutes,
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
