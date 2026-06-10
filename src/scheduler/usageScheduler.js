const cron = require('node-cron');
const db = require('../db/postgres');
const usageService = require('../services/usageService');
const { monitorAzureSignIns } = require('../services/azureSignInMonitor');
const { restoreAzureAccess } = require('../services/usageEnforcementService');

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
      const totalMinutes = session.usedTodayMinutes + session.currentSessionMinutes;

      // Check if user has exceeded or will exceed limit
      if (totalMinutes >= session.dailyLimitMinutes) {
        console.log(
          `[LIMIT_REACHED] Session ${session.sessionId} for user ${session.userId} exceeded limit. ` +
            `Total: ${totalMinutes} min, Limit: ${session.dailyLimitMinutes} min`
        );

        // Force logout the user using the service function
        try {
          await usageService.forceLogoutUser({
            requestId: session.requestId,
            userId: session.userId
          });
        } catch (error) {
          console.error(`[FORCE_LOGOUT] Error forcing logout for user ${session.userId}:`, error.message);
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
    console.log('[USAGE_RESET] Running daily usage counter reset...');

    // Get users that need to be restored in Azure
    const blockedUsersResult = await db.query(
      `
      SELECT 
        au.id,
        au.request_id,
        au.azure_user_id,
        au.azure_username,
        r.enforce_in_azure
      FROM azure_users au
      JOIN requests r ON r.id = au.request_id
      WHERE au.blocked_until IS NOT NULL
        AND r.enable_daily_usage = true 
        AND r.status NOT IN ('Cancelled', 'Expired')
        AND r.enforce_in_azure = true
      `
    );

    console.log(`[USAGE_RESET] Found ${blockedUsersResult.rowCount} blocked user(s) to restore in Azure.`);

    // Restore Azure accounts first
    for (const user of blockedUsersResult.rows) {
      try {
        await restoreAzureAccess({
          azureUserId: user.azure_user_id,
          userId: user.id,
          requestId: user.request_id
        });
        console.log(`[ACCOUNT_RESTORED] Azure account re-enabled for user ${user.id} (${user.azure_username})`);
      } catch (error) {
        console.error(
          `[USAGE_RESET] Error restoring Azure access for user ${user.id} (${user.azure_username}):`,
          error.message
        );
      }
    }

    // Reset database counters
    const result = await db.query(
      `
      UPDATE azure_users
      SET 
        used_today_minutes = 0,
        blocked_until = NULL,
        last_reset_date = CURRENT_DATE,
        status = 'Active'
      WHERE 
        request_id IN (
          SELECT id 
          FROM requests 
          WHERE enable_daily_usage = true 
            AND status NOT IN ('Cancelled', 'Expired')
        )
      RETURNING id, request_id, azure_username
      `
    );

    console.log(`[USAGE_RESET] Reset usage counters for ${result.rowCount} user(s).`);

    if (result.rowCount > 0) {
      // Log the reset action for each user
      for (const row of result.rows) {
        console.log(
          `[ACCESS_RESTORED] User ${row.id} (${row.azure_username || 'Unknown'}) - Request ${row.request_id} access restored after daily reset`
        );
      }

      // Log the reset action in enforcement logs
      await db.query(
        `
        INSERT INTO usage_enforcement_logs (
          request_id,
          user_id,
          action,
          details,
          created_at
        )
        SELECT 
          request_id,
          id,
          'daily_reset',
          '{"message": "Daily usage counters reset", "action": "access_restored", "azure_account_enabled": "true"}',
          NOW()
        FROM azure_users
        WHERE id = ANY($1)
        `,
        [result.rows.map((row) => row.id)]
      );
    }

    console.log('[USAGE_RESET] Daily usage counter reset completed.');
  } catch (error) {
    console.error('[USAGE_RESET] Error resetting daily usage counters:', error);
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

      // Then, monitor existing active sessions for usage limits
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
