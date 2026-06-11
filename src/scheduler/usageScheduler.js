const cron = require('node-cron');
const db = require('../db/postgres');
const usageService = require('../services/usageService');
const { monitorAzureSignIns } = require('../services/azureSignInMonitor');
const {
  restoreAzureAccess,
  enforceScheduleViolation,
  enforceBlockedAzureUsers
} = require('../services/usageEnforcementService');
const { evaluateUsageAccess } = require('../services/usageAccessEvaluator');
const { resetDailyCountersIfNeeded } = require('../services/usageMiddlewareHelper');

/**
 * Monitor active sessions every minute
 * Check if any session has caused user to exceed daily limit
 * Force logout if limit exceeded
 */
const monitorActiveSessions = async () => {
  try {
    console.log('Running active session monitor...');

    const sessions = await usageService.getActiveSessions();

    if (sessions.length === 0) {
      console.log('No active sessions to monitor.');
      return;
    }

    console.log(`Monitoring ${sessions.length} active session(s)`);

    for (const session of sessions) {
      const access = session.access;

      if (!access?.allowed) {
        console.log(
          `[SESSION_VIOLATION] Session ${session.sessionId} for user ${session.userId}: ${access.reason}`
        );

        try {
          if (access.reason === 'limit_exceeded') {
            await usageService.forceLogoutUser({
              requestId: session.requestId,
              userId: session.userId
            });
          } else if (session.enforceInAzure) {
            await enforceScheduleViolation({
              requestId: session.requestId,
              userId: session.userId,
              reason: access.reason,
              blockedUntil: access.blockedUntil,
              message: access.message
            });
          } else {
            await usageService.forceLogoutUser({
              requestId: session.requestId,
              userId: session.userId
            });
          }
        } catch (error) {
          console.error(`[FORCE_LOGOUT] Error enforcing session ${session.sessionId}:`, error.message);
        }
      }
    }

    console.log('Active session monitor completed.');
  } catch (error) {
    console.error('Error monitoring active sessions:', error);
  }
};

/**
 * Reset daily usage counters at midnight
 * Runs daily at 00:00 (midnight)
 * Also restores Azure account access for blocked users
 */
const resetDailyUsageCounters = async () => {
  try {
    console.log('[USAGE_RESET] Running timezone-aware daily usage counter reset...');

    const usersResult = await db.query(
      `
      SELECT
        au.id,
        au.request_id,
        au.username,
        au.used_today_minutes,
        au.last_reset_date,
        au.blocked_until,
        r.enable_daily_usage,
        r.daily_limit_minutes,
        r.usage_schedule
      FROM azure_users au
      JOIN requests r ON r.id = au.request_id
      WHERE r.enable_daily_usage = true
        AND r.status NOT IN ('Cancelled', 'Expired')
      `
    );

    let resetCount = 0;

    for (const row of usersResult.rows) {
      const beforeDate = row.last_reset_date
        ? new Date(row.last_reset_date).toISOString().split('T')[0]
        : null;
      const refreshed = await resetDailyCountersIfNeeded(row, row, row.id, row.request_id);
      const afterDate = refreshed.last_reset_date
        ? new Date(refreshed.last_reset_date).toISOString().split('T')[0]
        : null;

      if (beforeDate !== afterDate) {
        resetCount += 1;
        console.log(
          `[USAGE_RESET] Reset counters for user ${row.id} (${row.username || 'Unknown'}) on request ${row.request_id}`
        );
      }
    }

    await restoreScheduledAccess();
    console.log(`[USAGE_RESET] Completed. Reset ${resetCount} user(s) based on request time zones.`);
  } catch (error) {
    console.error('[USAGE_RESET] Error resetting daily usage counters:', error);
  }
};

const restoreScheduledAccess = async () => {
  try {
    const result = await db.query(
      `
      SELECT
        au.id,
        au.request_id,
        au.azure_user_id,
        au.username,
        au.used_today_minutes,
        au.last_reset_date,
        au.blocked_until,
        r.enable_daily_usage,
        r.daily_limit_minutes,
        r.usage_schedule,
        r.enforce_in_azure
      FROM azure_users au
      JOIN requests r ON r.id = au.request_id
      WHERE r.enable_daily_usage = true
        AND r.status NOT IN ('Cancelled', 'Expired')
        AND au.blocked_until IS NOT NULL
        AND au.blocked_until <= NOW()
      `
    );

    for (const row of result.rows) {
      const refreshedUser = await resetDailyCountersIfNeeded(row, row, row.id, row.request_id);
      const access = evaluateUsageAccess({
        request: row,
        user: refreshedUser,
        currentSessionMinutes: 0
      });

      if (!access.allowed) {
        continue;
      }

      if (row.enforce_in_azure) {
        try {
          await restoreAzureAccess({
            azureUserId: row.azure_user_id,
            userId: row.id,
            requestId: row.request_id
          });
        } catch (error) {
          console.error(`[ACCESS_RESTORED] Failed for user ${row.id}:`, error.message);
          continue;
        }
      }

      await db.query(
        `
        UPDATE azure_users
        SET blocked_until = NULL, status = 'Active'
        WHERE id = $1 AND request_id = $2
        `,
        [row.id, row.request_id]
      );

      console.log(`[ACCESS_RESTORED] User ${row.id} (${row.username}) restored for scheduled window.`);
    }
  } catch (error) {
    console.error('Error restoring scheduled access:', error);
  }
};

/**
 * Start all usage-related schedulers
 */
const startUsageScheduler = () => {
  console.log('Starting usage schedulers...');

  // Monitor active sessions every minute
  cron.schedule('* * * * *', async () => {
    try {
      // First, detect new Azure Portal logins and create sessions
      await monitorAzureSignIns();
      await enforceBlockedAzureUsers();
      await restoreScheduledAccess();
      await monitorActiveSessions();
    } catch (error) {
      console.error('Error in active session monitor job:', error);
    }
  });
  console.log('Active session monitor scheduled (every minute)');

  // Reset daily usage counters at midnight
  cron.schedule('0 0 * * *', () => {
    resetDailyUsageCounters().catch((error) => {
      console.error('Error in daily reset job:', error);
    });
  });
  console.log('Daily usage reset scheduled (00:00 every day)');

  console.log('Usage schedulers started successfully.');
};

module.exports = {
  startUsageScheduler,
  monitorActiveSessions,
  resetDailyUsageCounters
};
