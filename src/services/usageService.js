const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const usageEnforcementService = require('./usageEnforcementService');

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
        expiry_date,
        status
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

    // If daily usage limit is enabled, check if user is blocked or exceeded limit
    if (request.enable_daily_usage) {
      // Check if user is currently blocked
      if (user.blocked_until) {
        const now = new Date();
        const blockedUntil = new Date(user.blocked_until);
        if (now < blockedUntil) {
          console.log(`[SESSION_STARTED] User ${userId} is blocked until ${blockedUntil.toISOString()}`);
          throw new AppError(
            `Access is blocked until ${blockedUntil.toISOString()}. Daily usage limit exceeded.`,
            403
          );
        }
      }

      // Reset counters if date has changed
      const today = new Date().toISOString().split('T')[0];
      const lastResetDate = user.last_reset_date
        ? new Date(user.last_reset_date).toISOString().split('T')[0]
        : null;

      if (lastResetDate !== today) {
        console.log(`[SESSION_STARTED] Resetting daily counters for user ${userId}`);
        await client.query(
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
      } else {
        // Check if user has exceeded daily limit
        const usedMinutes = Number(user.used_today_minutes || 0);
        const limitMinutes = Number(request.daily_limit_minutes || 0);

        if (usedMinutes >= limitMinutes) {
          console.log(`[SESSION_STARTED] User ${userId} has exceeded daily limit: ${usedMinutes}/${limitMinutes}`);
          throw new AppError(
            'Daily usage limit exceeded. Access is restricted until tomorrow.',
            403
          );
        }
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
        daily_limit_minutes
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
      const limitMinutes = Number(request.daily_limit_minutes || 0);

      console.log(`[SESSION_ENDED] User ${userId} total usage: ${usedMinutes}/${limitMinutes} minutes`);

      // Check if limit exceeded
      if (usedMinutes >= limitMinutes) {
        console.log(`[LIMIT_REACHED] User ${userId} exceeded limit. Blocking and forcing logout.`);

        // Block user until tomorrow midnight
        await client.query(
          `
          UPDATE azure_users
          SET blocked_until = (CURRENT_DATE + INTERVAL '1 day')
          WHERE id = $1 AND request_id = $2
          `,
          [userId, requestId]
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
  
  // Get active session if exists
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

  // Calculate LIVE usage
  let storedUsedMinutes = Number(data.used_today_minutes || 0);
  let currentSessionMinutes = 0;
  let hasActiveSession = false;
  let activeSessionId = null;
  let activeSessionLoginAt = null;

  if (activeSessionResult.rows.length > 0) {
    hasActiveSession = true;
    activeSessionId = activeSessionResult.rows[0].id;
    activeSessionLoginAt = activeSessionResult.rows[0].login_at;
    // Floor the elapsed minutes (round down)
    currentSessionMinutes = Math.floor(Number(activeSessionResult.rows[0].elapsed_minutes || 0));
  }

  // Total used minutes = stored + current active session
  const usedMinutes = storedUsedMinutes + currentSessionMinutes;
  const limitMinutes = Number(data.daily_limit_minutes || 0);
  let remainingMinutes = data.enable_daily_usage ? Math.max(0, limitMinutes - usedMinutes) : null;

  // Check if currently blocked or limit reached
  let isBlocked = false;
  if (data.blocked_until) {
    const now = new Date();
    const blockedUntil = new Date(data.blocked_until);
    isBlocked = now < blockedUntil;
  }

  // Check if limit is reached (even with active session) - HARD BLOCK
  if (data.enable_daily_usage && usedMinutes >= limitMinutes) {
    isBlocked = true;
    // Ensure remainingMinutes is 0
    remainingMinutes = 0;
  }

  // Check if expired
  let isExpired = false;
  if (data.expiry_date) {
    const now = new Date();
    const expiryDate = new Date(data.expiry_date);
    isExpired = now > expiryDate;
  }

  console.log(`[USAGE_STATUS_CALCULATED] Request ${requestId}, User ${userId}: stored=${storedUsedMinutes}, active=${currentSessionMinutes}, total=${usedMinutes}, limit=${limitMinutes}, blocked=${isBlocked}`);

  return {
    requestId: data.request_id,
    userId: data.user_id,
    enableDailyUsage: data.enable_daily_usage || false,
    dailyLimitMinutes: limitMinutes,
    usedMinutes,
    storedUsedMinutes,
    currentSessionMinutes,
    remainingMinutes,
    blocked: isBlocked,
    blockedUntil: data.blocked_until,
    expired: isExpired,
    expiryDate: data.expiry_date,
    lastResetDate: data.last_reset_date,
    hasActiveSession,
    activeSessionId,
    activeSessionLoginAt,
    requestStatus: data.request_status
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
      au.used_today_minutes,
      FLOOR(EXTRACT(EPOCH FROM (NOW() - uus.login_at)) / 60) as current_session_minutes
    FROM user_usage_sessions uus
    JOIN requests r ON r.id = uus.request_id
    JOIN azure_users au ON au.id = uus.user_id AND au.request_id = uus.request_id
    WHERE uus.logout_at IS NULL
      AND r.enable_daily_usage = true
    ORDER BY uus.login_at ASC
    `
  );

  return result.rows.map((row) => ({
    sessionId: row.session_id,
    requestId: row.request_id,
    userId: row.user_id,
    loginAt: row.login_at,
    currentSessionMinutes: Number(row.current_session_minutes || 0),
    usedTodayMinutes: Number(row.used_today_minutes || 0),
    dailyLimitMinutes: Number(row.daily_limit_minutes || 0),
    totalUsedMinutes: Number(row.used_today_minutes || 0) + Number(row.current_session_minutes || 0)
  }));
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

    // Update user's used minutes and block until tomorrow
    const userUpdateResult = await client.query(
      `
      UPDATE azure_users
      SET 
        used_today_minutes = COALESCE(used_today_minutes, 0) + $1,
        blocked_until = (CURRENT_DATE + INTERVAL '1 day')
      WHERE id = $2 AND request_id = $3
      RETURNING used_today_minutes, blocked_until
      `,
      [totalMinutesUsed, userId, requestId]
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
