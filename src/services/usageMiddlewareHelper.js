const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const { evaluateUsageAccess } = require('./usageAccessEvaluator');
const usageEnforcementService = require('./usageEnforcementService');
const { getCalendarDateInTimezone, resolveScheduleForRequest } = require('../utils/usageSchedule');

async function getLiveSessionMinutes(requestId, userId) {
  const activeSessionResult = await db.query(
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

async function resetDailyCountersIfNeeded(request, user, userId, requestId, client = db) {
  const schedule = resolveScheduleForRequest(request);
  const timezone = schedule?.timezone || 'UTC';
  const calendarDate = getCalendarDateInTimezone(timezone);
  const lastResetDate = user.last_reset_date
    ? new Date(user.last_reset_date).toISOString().split('T')[0]
    : null;

  let refreshedUser = user;

  if (lastResetDate !== calendarDate) {
    const resetResult = await client.query(
      `
      UPDATE azure_users
      SET
        used_today_minutes = 0,
        last_reset_date = $3::date
      WHERE id = $1 AND request_id = $2
      RETURNING used_today_minutes, last_reset_date, blocked_until, status
      `,
      [userId, requestId, calendarDate]
    );

    refreshedUser = {
      ...user,
      used_today_minutes: resetResult.rows[0].used_today_minutes,
      last_reset_date: resetResult.rows[0].last_reset_date,
      blocked_until: resetResult.rows[0].blocked_until,
      status: resetResult.rows[0].status
    };
  }

  if (!request?.enable_daily_usage) {
    return refreshedUser;
  }

  const access = evaluateUsageAccess({
    request,
    user: refreshedUser,
    currentSessionMinutes: 0
  });

  if (!access.allowed) {
    const statusResult = await client.query(
      `
      UPDATE azure_users
      SET
        blocked_until = $3,
        status = 'Blocked'
      WHERE id = $1 AND request_id = $2
      RETURNING used_today_minutes, last_reset_date, blocked_until, status
      `,
      [userId, requestId, access.blockedUntil]
    );

    return {
      ...refreshedUser,
      used_today_minutes: statusResult.rows[0].used_today_minutes,
      last_reset_date: statusResult.rows[0].last_reset_date,
      blocked_until: statusResult.rows[0].blocked_until,
      status: statusResult.rows[0].status
    };
  }

  if (refreshedUser.blocked_until || refreshedUser.status === 'Blocked') {
    const statusResult = await client.query(
      `
      UPDATE azure_users
      SET
        blocked_until = NULL,
        status = 'Active'
      WHERE id = $1 AND request_id = $2
      RETURNING used_today_minutes, last_reset_date, blocked_until, status
      `,
      [userId, requestId]
    );

    return {
      ...refreshedUser,
      used_today_minutes: statusResult.rows[0].used_today_minutes,
      last_reset_date: statusResult.rows[0].last_reset_date,
      blocked_until: statusResult.rows[0].blocked_until,
      status: statusResult.rows[0].status
    };
  }

  return refreshedUser;
}

async function evaluateRequestUserAccess({ requestId, userId, enforceOnDeny = false }) {
  const result = await db.query(
    `
    SELECT
      r.id as request_id,
      r.enable_daily_usage,
      r.daily_limit_minutes,
      r.usage_schedule,
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

  if (result.rows.length === 0 || !result.rows[0].user_id) {
    throw new AppError('Request or user not found.', 404);
  }

  const data = result.rows[0];

  if (data.request_status === 'Cancelled' || data.request_status === 'Expired') {
    throw new AppError('Request is no longer active.', 403);
  }

  if (data.expiry_date) {
    const now = new Date();
    const expiryDate = new Date(data.expiry_date);
    if (now > expiryDate) {
      throw new AppError('Access has expired.', 403);
    }
  }

  if (!data.enable_daily_usage) {
    return {
      data,
      access: {
        allowed: true,
        dailyUsageEnabled: false
      }
    };
  }

  const refreshedUser = await resetDailyCountersIfNeeded(data, data, userId, requestId);
  const currentSessionMinutes = await getLiveSessionMinutes(requestId, userId);
  const access = evaluateUsageAccess({
    request: data,
    user: refreshedUser,
    currentSessionMinutes
  });

  if (!access.allowed) {
    if (enforceOnDeny && data.enforce_in_azure) {
      if (access.reason === 'limit_exceeded') {
        usageEnforcementService
          .enforceUsageLimit({ requestId, userId })
          .catch((error) => console.error('[ACCESS_CHECK] Enforcement error:', error));
      } else if (['outside_window', 'day_disabled', 'blocked'].includes(access.reason)) {
        usageEnforcementService
          .enforceScheduleViolation({
            requestId,
            userId,
            reason: access.reason,
            blockedUntil: access.blockedUntil,
            message: access.message
          })
          .catch((error) => console.error('[ACCESS_CHECK] Schedule enforcement error:', error));
      }
    }

    throw new AppError(access.message, 403);
  }

  return { data, access };
}

module.exports = {
  evaluateRequestUserAccess,
  resetDailyCountersIfNeeded,
  getLiveSessionMinutes
};
