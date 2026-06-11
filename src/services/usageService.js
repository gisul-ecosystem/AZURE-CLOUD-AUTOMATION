const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const usageEnforcementService = require('./usageEnforcementService');
const { evaluateUsageAccess } = require('./usageAccessEvaluator');
const { resetDailyCountersIfNeeded } = require('./usageMiddlewareHelper');
const {
  getTodayLimitMinutes,
  resolveScheduleForRequest
} = require('../utils/usageSchedule');

async function getLiveSessionMinutes(client, requestId, userId) {
  const activeSessionResult = await client.query(
    `
    SELECT FLOOR(EXTRACT(EPOCH FROM (NOW() - login_at)) / 60) as elapsed_minutes
    FROM user_usage_sessions
    WHERE request_id = $1
      AND user_id = $2
      AND logout_at IS NULL
    ORDER BY login_at DESC
    LIMIT 1
    `,
    [requestId, userId]
  );

  if (activeSessionResult.rows.length === 0) {
    return 0;
  }

  return Number(activeSessionResult.rows[0].elapsed_minutes || 0);
}

async function ensureDailyReset(client, request, user, userId, requestId) {
  return resetDailyCountersIfNeeded(request, user, userId, requestId, client);
}

function getRequestLimitMinutes(request, at = new Date()) {
  const schedule = resolveScheduleForRequest(request);
  if (schedule) {
    return getTodayLimitMinutes(schedule, at);
  }
  return Number(request.daily_limit_minutes || 0);
}

/**
 * Start a usage session
 */
async function startUsageSession({ requestId, userId }) {
  console.log(`[SESSION_STARTED] Starting session for request ${requestId}, user ${userId}`);

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Check if request exists and get usage settings
    const requestResult = await client.query(
      `
      SELECT
        id,
        enable_daily_usage,
        daily_limit_minutes,
        usage_schedule,
        expiry_date,
        status,
        enforce_in_azure
      FROM requests
      WHERE id = $1
      `,
      [requestId]
    );

    if (requestResult.rows.length === 0) {
      throw new AppError('Request not found.', 404);
    }

    const request = requestResult.rows[0];

    // Check if request is still active
    if (request.status === 'Cancelled' || request.status === 'Expired') {
      throw new AppError('Request is no longer active.', 403);
    }

    // Check if request has expired
    if (request.expiry_date) {
      const now = new Date();
      const expiryDate = new Date(request.expiry_date);
      if (now > expiryDate) {
        throw new AppError('Access has expired.', 403);
      }
    }

    // Check if user exists in azure_users table
    const userResult = await client.query(
      `
      SELECT 
        id,
        request_id,
        used_today_minutes,
        last_reset_date,
        blocked_until
      FROM azure_users
      WHERE id = $1 AND request_id = $2
      `,
      [userId, requestId]
    );

    if (userResult.rows.length === 0) {
      throw new AppError('User not found for this request.', 404);
    }

    const user = userResult.rows[0];

    if (request.enable_daily_usage) {
      const refreshedUser = await ensureDailyReset(client, request, user, userId, requestId);
      const access = evaluateUsageAccess({
        request,
        user: refreshedUser,
        currentSessionMinutes: 0
      });

      if (!access.allowed) {
        console.log(`[SESSION_STARTED] User ${userId} denied: ${access.reason}`);
        throw new AppError(access.message, 403);
      }
    }

    // Check if there's already an active session (no logout_at)
    const activeSessionResult = await client.query(
      `
      SELECT id, login_at
      FROM user_usage_sessions
      WHERE request_id = $1 
        AND user_id = $2 
        AND logout_at IS NULL
      ORDER BY login_at DESC
      LIMIT 1
      `,
      [requestId, userId]
    );

    if (activeSessionResult.rows.length > 0) {
      // Return the existing active session - don't create new one
      await client.query('COMMIT');
      console.log(`[SESSION_STARTED] Active session already exists: ${activeSessionResult.rows[0].id}`);
      return {
        sessionId: activeSessionResult.rows[0].id,
        loginAt: activeSessionResult.rows[0].login_at,
        message: 'Active session already exists.',
        alreadyActive: true
      };
    }

    // Create new session
    const sessionResult = await client.query(
      `
      INSERT INTO user_usage_sessions (
        request_id,
        user_id,
        login_at
      )
      VALUES ($1, $2, NOW())
      RETURNING id, login_at
      `,
      [requestId, userId]
    );

    await client.query('COMMIT');

    console.log(`[SESSION_STARTED] New session created: ${sessionResult.rows[0].id} at ${sessionResult.rows[0].login_at}`);

    return {
      sessionId: sessionResult.rows[0].id,
      loginAt: sessionResult.rows[0].login_at,
      message: 'Usage session started successfully.'
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[SESSION_STARTED] Error starting session:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * End a usage session
 */
async function endUsageSession({ requestId, userId }) {
  console.log(`[SESSION_ENDED] Ending session for request ${requestId}, user ${userId}`);

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Find active session
    const sessionResult = await client.query(
      `
      SELECT id, login_at
      FROM user_usage_sessions
      WHERE request_id = $1 
        AND user_id = $2 
        AND logout_at IS NULL
      ORDER BY login_at DESC
      LIMIT 1
      `,
      [requestId, userId]
    );

    if (sessionResult.rows.length === 0) {
      throw new AppError('No active session found.', 404);
    }

    const session = sessionResult.rows[0];
    const loginAt = new Date(session.login_at);
    const logoutAt = new Date();

    // Calculate elapsed minutes (round up to nearest minute to prevent gaming the system)
    const elapsedMs = logoutAt - loginAt;
    const minutesUsed = Math.ceil(elapsedMs / 60000);

    console.log(`[SESSION_ENDED] Session ${session.id}: login=${loginAt.toISOString()}, logout=${logoutAt.toISOString()}, elapsed=${minutesUsed} minutes`);

    // Update session with logout time and minutes used
    await client.query(
      `
      UPDATE user_usage_sessions
      SET 
        logout_at = $1,
        minutes_used = $2
      WHERE id = $3
      `,
      [logoutAt, minutesUsed, session.id]
    );

    // Get request to check if daily usage is enabled
    const requestResult = await client.query(
      `
      SELECT
        enable_daily_usage,
        daily_limit_minutes,
        usage_schedule
      FROM requests
      WHERE id = $1
      `,
      [requestId]
    );

    if (requestResult.rows.length === 0) {
      throw new AppError('Request not found.', 404);
    }

    const request = requestResult.rows[0];

    // If daily usage is enabled, update user's used_today_minutes
    if (request.enable_daily_usage) {
      const updateResult = await client.query(
        `
        UPDATE azure_users
        SET used_today_minutes = COALESCE(used_today_minutes, 0) + $1
        WHERE id = $2 AND request_id = $3
        RETURNING used_today_minutes
        `,
        [minutesUsed, userId, requestId]
      );

      const usedMinutes = Number(updateResult.rows[0].used_today_minutes || 0);
      const limitMinutes = getRequestLimitMinutes(request);

      console.log(`[SESSION_ENDED] User ${userId} total usage: ${usedMinutes}/${limitMinutes} minutes`);

      if (usedMinutes >= limitMinutes) {
        console.log(`[LIMIT_REACHED] User ${userId} exceeded limit. Blocking and forcing logout.`);

        const access = evaluateUsageAccess({
          request,
          user: { used_today_minutes: usedMinutes },
          currentSessionMinutes: 0
        });

        await client.query(
          `
          UPDATE azure_users
          SET blocked_until = $3
          WHERE id = $1 AND request_id = $2
          `,
          [userId, requestId, access.blockedUntil || new Date(Date.now() + 24 * 60 * 60 * 1000)]
        );

        // Force end ALL active sessions for this user
        const forcedLogoutResult = await client.query(
          `
          UPDATE user_usage_sessions
          SET 
            logout_at = NOW(),
            minutes_used = GREATEST(COALESCE(minutes_used, 0), EXTRACT(EPOCH FROM (NOW() - login_at)) / 60)
          WHERE request_id = $1 
            AND user_id = $2 
            AND logout_at IS NULL
            AND id != $3
          RETURNING id
          `,
          [requestId, userId, session.id]
        );

        if (forcedLogoutResult.rows.length > 0) {
          console.log(`[LIMIT_REACHED] Forced logout of ${forcedLogoutResult.rows.length} other active session(s)`);
        }

        await client.query('COMMIT');

        // Trigger Azure enforcement asynchronously (don't wait for it)
        usageEnforcementService
          .enforceUsageLimit({ requestId, userId })
          .catch((error) => {
            console.error('[SESSION_ENDED] Error enforcing usage limit:', error);
          });

        return {
          sessionId: session.id,
          minutesUsed,
          usedTodayMinutes: usedMinutes,
          limitExceeded: true,
          forcedLogout: true,
          message: 'Session ended. Daily usage limit exceeded. All active sessions terminated. Access is blocked until tomorrow.'
        };
      }
    }

    await client.query('COMMIT');

    console.log(`[SESSION_ENDED] Session ${session.id} ended successfully. ${minutesUsed} minutes used.`);

    return {
      sessionId: session.id,
      minutesUsed,
      message: 'Usage session ended successfully.'
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[SESSION_ENDED] Error ending session:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get usage status for a user with LIVE calculation
 */
async function getUsageStatus({ requestId, userId }) {
  console.log(`[USAGE_STATUS_CALCULATED] Calculating live usage for request ${requestId}, user ${userId}`);

  const result = await db.query(
    `
    SELECT
      r.id as request_id,
      r.enable_daily_usage,
      r.daily_limit_minutes,
      r.usage_schedule,
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
  const activeSessionResult = await db.query(
    `
    SELECT
      id,
      login_at,
      EXTRACT(EPOCH FROM (NOW() - login_at)) / 60 as elapsed_minutes
    FROM user_usage_sessions
    WHERE request_id = $1
      AND user_id = $2
      AND logout_at IS NULL
    ORDER BY login_at DESC
    LIMIT 1
    `,
    [requestId, userId]
  );

  let hasActiveSession = false;
  let activeSessionId = null;
  let activeSessionLoginAt = null;
  let currentSessionMinutes = 0;

  if (activeSessionResult.rows.length > 0) {
    hasActiveSession = true;
    activeSessionId = activeSessionResult.rows[0].id;
    activeSessionLoginAt = activeSessionResult.rows[0].login_at;
    currentSessionMinutes = Math.floor(Number(activeSessionResult.rows[0].elapsed_minutes || 0));
  }

  const refreshedUser = await ensureDailyReset(db, data, data, userId, requestId);
  const access = evaluateUsageAccess({
    request: data,
    user: refreshedUser,
    currentSessionMinutes
  });

  let isExpired = false;
  if (data.expiry_date) {
    const now = new Date();
    const expiryDate = new Date(data.expiry_date);
    isExpired = now > expiryDate;
  }

  const isBlocked = !access.allowed && ['blocked', 'limit_exceeded', 'outside_window', 'day_disabled'].includes(access.reason);

  console.log(
    `[USAGE_STATUS_CALCULATED] Request ${requestId}, User ${userId}: ` +
      `stored=${access.storedUsedMinutes}, active=${currentSessionMinutes}, ` +
      `total=${access.usedMinutes}, limit=${access.limitMinutes}, ` +
      `withinWindow=${access.withinWindow}, blocked=${isBlocked}`
  );

  return {
    requestId: data.request_id,
    userId: data.user_id,
    enableDailyUsage: data.enable_daily_usage || false,
    dailyLimitMinutes: access.limitMinutes,
    usedMinutes: access.usedMinutes,
    storedUsedMinutes: access.storedUsedMinutes,
    currentSessionMinutes,
    remainingMinutes: access.remainingMinutes,
    blocked: isBlocked,
    blockedUntil: access.blockedUntil || data.blocked_until,
    expired: isExpired,
    expiryDate: data.expiry_date,
    lastResetDate: refreshedUser.last_reset_date || data.last_reset_date,
    hasActiveSession,
    activeSessionId,
    activeSessionLoginAt,
    requestStatus: data.request_status,
    withinWindow: access.withinWindow,
    scheduleSummary: access.scheduleSummary,
    usageSchedule: access.schedule,
    accessReason: access.reason,
    accessMessage: access.message
  };
}

/**
 * Get all active sessions with LIVE elapsed time
 */
async function getActiveSessions() {
  const result = await db.query(
    `
    SELECT
      uus.id as session_id,
      uus.request_id,
      uus.user_id,
      uus.login_at,
      r.enable_daily_usage,
      r.daily_limit_minutes,
      r.usage_schedule,
      r.enforce_in_azure,
      au.used_today_minutes,
      au.last_reset_date,
      au.blocked_until,
      FLOOR(EXTRACT(EPOCH FROM (NOW() - uus.login_at)) / 60) as current_session_minutes
    FROM user_usage_sessions uus
    JOIN requests r ON r.id = uus.request_id
    JOIN azure_users au ON au.id = uus.user_id AND au.request_id = uus.request_id
    WHERE uus.logout_at IS NULL
      AND r.enable_daily_usage = true
    ORDER BY uus.login_at ASC
    `
  );

  return result.rows.map((row) => {
    const currentSessionMinutes = Number(row.current_session_minutes || 0);
    const access = evaluateUsageAccess({
      request: row,
      user: row,
      currentSessionMinutes
    });

    return {
      sessionId: row.session_id,
      requestId: row.request_id,
      userId: row.user_id,
      loginAt: row.login_at,
      enforceInAzure: row.enforce_in_azure === true,
      currentSessionMinutes,
      usedTodayMinutes: Number(access.storedUsedMinutes || 0),
      dailyLimitMinutes: Number(access.limitMinutes || 0),
      totalUsedMinutes: Number(access.usedMinutes || 0),
      withinWindow: access.withinWindow,
      access,
      request: row
    };
  });
}

/**
 * Force logout a user - close all active sessions and block access
 * Used when daily limit is exceeded
 */
async function forceLogoutUser({ requestId, userId }) {
  console.log(`[FORCE_LOGOUT] Force logging out user ${userId} for request ${requestId}`);

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Get all active sessions for this user
    const activeSessionsResult = await client.query(
      `
      SELECT 
        id,
        login_at,
        EXTRACT(EPOCH FROM (NOW() - login_at)) / 60 as elapsed_minutes
      FROM user_usage_sessions
      WHERE request_id = $1 
        AND user_id = $2 
        AND logout_at IS NULL
      `,
      [requestId, userId]
    );

    if (activeSessionsResult.rows.length === 0) {
      console.log(`[FORCE_LOGOUT] No active sessions found for user ${userId}`);
      await client.query('COMMIT');
      return {
        success: true,
        message: 'No active sessions to logout.',
        sessionsClosedCount: 0
      };
    }

    // Calculate total minutes used in active sessions
    let totalMinutesUsed = 0;
    for (const session of activeSessionsResult.rows) {
      const minutesUsed = Math.ceil(Number(session.elapsed_minutes || 0));
      totalMinutesUsed += minutesUsed;
    }

    // Close all active sessions
    await client.query(
      `
      UPDATE user_usage_sessions
      SET 
        logout_at = NOW(),
        minutes_used = EXTRACT(EPOCH FROM (NOW() - login_at)) / 60
      WHERE request_id = $1 
        AND user_id = $2 
        AND logout_at IS NULL
      `,
      [requestId, userId]
    );

    const contextResult = await client.query(
      `
      SELECT
        r.enable_daily_usage,
        r.daily_limit_minutes,
        r.usage_schedule,
        au.used_today_minutes
      FROM requests r
      JOIN azure_users au ON au.request_id = r.id
      WHERE r.id = $1 AND au.id = $2
      `,
      [requestId, userId]
    );
    const context = contextResult.rows[0] || {};
    const projectedUsedMinutes =
      Number(context.used_today_minutes || 0) + Number(totalMinutesUsed || 0);
    const access = evaluateUsageAccess({
      request: context,
      user: {
        used_today_minutes: projectedUsedMinutes
      },
      currentSessionMinutes: 0
    });

    const userUpdateResult = await client.query(
      `
      UPDATE azure_users
      SET
        used_today_minutes = COALESCE(used_today_minutes, 0) + $1,
        blocked_until = $4
      WHERE id = $2 AND request_id = $3
      RETURNING used_today_minutes, blocked_until
      `,
      [
        totalMinutesUsed,
        userId,
        requestId,
        access.blockedUntil || new Date(Date.now() + 24 * 60 * 60 * 1000)
      ]
    );

    await client.query('COMMIT');

    console.log(
      `[FORCE_LOGOUT] Closed ${activeSessionsResult.rows.length} session(s) for user ${userId}. ` +
      `Total minutes: ${userUpdateResult.rows[0].used_today_minutes}. ` +
      `Blocked until: ${userUpdateResult.rows[0].blocked_until}`
    );

    // Trigger Azure enforcement asynchronously
    usageEnforcementService
      .enforceUsageLimit({ requestId, userId })
      .catch((error) => {
        console.error('[FORCE_LOGOUT] Error enforcing usage limit:', error);
      });

    return {
      success: true,
      message: 'User has been force logged out. All active sessions closed.',
      sessionsClosedCount: activeSessionsResult.rows.length,
      totalMinutesUsed,
      blockedUntil: userUpdateResult.rows[0].blocked_until
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[FORCE_LOGOUT] Error force logging out user:`, error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  startUsageSession,
  endUsageSession,
  getUsageStatus,
  getActiveSessions,
  forceLogoutUser
};
