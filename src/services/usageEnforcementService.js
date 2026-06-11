const { Client } = require('@microsoft/microsoft-graph-client');
const { ClientSecretCredential } = require('@azure/identity');
const { createAzureCredential, validateAzureEnv } = require('../config/azure');
const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const { getTodayLimitMinutes, resolveScheduleForRequest } = require('../utils/usageSchedule');
const { evaluateUsageAccess } = require('./usageAccessEvaluator');

/**
 * Create Microsoft Graph client
 */
const createGraphClient = () => {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing required Azure credentials for Graph API');
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);

  const client = Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken('https://graph.microsoft.com/.default');
        return token.token;
      }
    }
  });

  return client;
};

/**
 * Revoke Azure access by terminating sessions and disabling account
 * Does NOT remove RBAC assignments - preserves permissions for next day
 */
async function revokeAzureAccess({ azureUserId, userId, requestId }) {
  try {
    console.log(`[AZURE_REVOKE] Revoking Azure access for user ${userId} (Azure ID: ${azureUserId})`);

    const client = createGraphClient();
    const actions = [];

    // Step 1: Revoke all active sign-in sessions
    try {
      await client.api(`/users/${azureUserId}/revokeSignInSessions`).post({});
      console.log(`[AZURE_SESSION_REVOKED] All sign-in sessions revoked for Azure user ${azureUserId}`);
      actions.push({ action: 'revoke_sessions', status: 'success' });
    } catch (error) {
      console.error(`[AZURE_REVOKE] Error revoking sessions: ${error.message}`);
      actions.push({ action: 'revoke_sessions', status: 'failed', error: error.message });
    }

    // Step 2: Disable the Azure account
    try {
      await client.api(`/users/${azureUserId}`).patch({
        accountEnabled: false
      });

      const userState = await client
        .api(`/users/${azureUserId}`)
        .select('accountEnabled')
        .get();

      if (userState.accountEnabled !== false) {
        console.error(
          `[AZURE_REVOKE] Account ${azureUserId} is still enabled after disable attempt`
        );
        actions.push({ action: 'disable_account', status: 'failed', error: 'account_still_enabled' });
      } else {
        console.log(`[ACCOUNT_DISABLED] Azure account disabled for user ${azureUserId}`);
        actions.push({ action: 'disable_account', status: 'success' });
      }
    } catch (error) {
      console.error(`[AZURE_REVOKE] Error disabling account: ${error.message}`);
      actions.push({ action: 'disable_account', status: 'failed', error: error.message });
    }

    console.log(
      '[AZURE_REVOKE] Active portal tabs may stay usable until the current access token expires ' +
      '(often up to ~60 minutes). Refresh/revoke blocks new sign-ins immediately.'
    );

    return actions;
  } catch (error) {
    console.error(`[AZURE_REVOKE] Error revoking Azure access:`, error);
    throw error;
  }
}

/**
 * Restore Azure access by enabling account
 * Used during daily reset at midnight
 */
async function restoreAzureAccess({ azureUserId, userId, requestId }) {
  try {
    console.log(`[AZURE_RESTORE] Restoring Azure access for user ${userId} (Azure ID: ${azureUserId})`);

    const client = createGraphClient();

    // Re-enable the Azure account
    await client.api(`/users/${azureUserId}`).patch({
      accountEnabled: true
    });

    console.log(`[ACCOUNT_RESTORED] Azure account re-enabled for user ${azureUserId}`);

    return {
      action: 'restore_account',
      status: 'success'
    };
  } catch (error) {
    console.error(`[AZURE_RESTORE] Error restoring Azure access:`, error);
    throw error;
  }
}

/**
 * Enforce usage limit by revoking Azure sessions and disabling account
 * RBAC assignments are preserved for next day
 */
async function enforceUsageLimit({ requestId, userId }) {
  try {
    console.log(`[ENFORCEMENT] Enforcing usage limit for request ${requestId}, user ${userId}`);

    // Get request and user details
    const result = await db.query(
      `
      SELECT 
        r.id as request_id,
        r.enforce_in_azure,
        au.id as user_id,
        au.azure_user_id,
        au.username,
        au.used_today_minutes,
        r.daily_limit_minutes,
        r.usage_schedule,
        r.enable_daily_usage
      FROM requests r
      JOIN azure_users au ON au.request_id = r.id
      WHERE r.id = $1 AND au.id = $2
      `,
      [requestId, userId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Request or user not found.', 404);
    }

    const data = result.rows[0];

    // Check if enforcement in Azure is enabled
    if (!data.enforce_in_azure) {
      console.log(`[ENFORCEMENT] Azure enforcement disabled for request ${requestId}. Skipping.`);
      return {
        success: true,
        message: 'Azure enforcement is disabled for this request.',
        enforced: false
      };
    }

    // Verify user exceeded limit
    const usedMinutes = Number(data.used_today_minutes || 0);
    const schedule = resolveScheduleForRequest(data);
    const limitMinutes = schedule
      ? getTodayLimitMinutes(schedule)
      : Number(data.daily_limit_minutes || 0);

    if (usedMinutes < limitMinutes) {
      console.log(`[ENFORCEMENT] User ${userId} has not exceeded limit. Skipping enforcement.`);
      return {
        success: true,
        message: 'User has not exceeded daily limit.',
        enforced: false
      };
    }

    console.log(
      `[ENFORCEMENT] User ${userId} (${data.username}) exceeded limit: ${usedMinutes}/${limitMinutes} minutes`
    );

    // Revoke Azure sessions and disable account
    const azureActions = await revokeAzureAccess({
      azureUserId: data.azure_user_id,
      userId,
      requestId
    });

    // Update database status
    await db.query(
      `
      UPDATE azure_users
      SET 
        blocked_until = (CURRENT_DATE + INTERVAL '1 day'),
        status = 'Blocked'
      WHERE id = $1 AND request_id = $2
      `,
      [userId, requestId]
    );

    // Close all active sessions
    await db.query(
      `
      UPDATE user_usage_sessions
      SET logout_at = NOW()
      WHERE request_id = $1 
        AND user_id = $2 
        AND logout_at IS NULL
      `,
      [requestId, userId]
    );

    // Log enforcement action
    await db.query(
      `
      INSERT INTO usage_enforcement_logs (
        request_id,
        user_id,
        action,
        details,
        created_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      `,
      [
        requestId,
        userId,
        'limit_exceeded_azure_revoked',
        JSON.stringify({
          azureActions,
          usedMinutes,
          limitMinutes,
          azureUsername: data.username,
          message: 'Azure sessions revoked and account disabled. RBAC preserved.'
        })
      ]
    );

    console.log(
      `[ENFORCEMENT] Azure access revoked for user ${userId} (${data.username}). ` +
      `Account disabled. RBAC assignments preserved.`
    );

    return {
      success: true,
      message: 'Usage limit enforced. Azure sessions revoked and account disabled. RBAC preserved.',
      enforced: true,
      details: {
        azureActions
      }
    };
  } catch (error) {
    console.error('[ENFORCEMENT] Error enforcing usage limit:', error);
    
    // Log error but don't throw - enforcement failures shouldn't break the flow
    try {
      await db.query(
        `
        INSERT INTO usage_enforcement_logs (
          request_id,
          user_id,
          action,
          details,
          created_at
        )
        VALUES ($1, $2, $3, $4, NOW())
        `,
        [
          requestId,
          userId,
          'enforcement_error',
          JSON.stringify({
            error: error.message,
            stack: error.stack
          })
        ]
      );
    } catch (logError) {
      console.error('[ENFORCEMENT] Error logging enforcement failure:', logError);
    }

    return {
      success: false,
      message: error.message,
      enforced: false
    };
  }
}

async function enforceScheduleViolation({
  requestId,
  userId,
  reason = 'outside_window',
  blockedUntil = null,
  message = 'Scheduled access violation.'
}) {
  try {
    console.log(`[ENFORCEMENT] Schedule violation (${reason}) for request ${requestId}, user ${userId}`);

    const result = await db.query(
      `
      SELECT
        r.id as request_id,
        r.enforce_in_azure,
        au.id as user_id,
        au.azure_user_id,
        au.username
      FROM requests r
      JOIN azure_users au ON au.request_id = r.id
      WHERE r.id = $1 AND au.id = $2
      `,
      [requestId, userId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Request or user not found.', 404);
    }

    const data = result.rows[0];
    const nextBlockedUntil = blockedUntil || new Date(Date.now() + 60 * 60 * 1000);
    let azureActions = [];

    if (data.enforce_in_azure) {
      azureActions = await revokeAzureAccess({
        azureUserId: data.azure_user_id,
        userId,
        requestId
      });
    }

    await db.query(
      `
      UPDATE azure_users
      SET
        blocked_until = $3,
        status = 'Blocked'
      WHERE id = $1 AND request_id = $2
      `,
      [userId, requestId, nextBlockedUntil]
    );

    await db.query(
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

    await db.query(
      `
      INSERT INTO usage_enforcement_logs (
        request_id,
        user_id,
        action,
        details,
        created_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      `,
      [
        requestId,
        userId,
        `schedule_${reason}`,
        JSON.stringify({
          reason,
          message,
          blockedUntil: nextBlockedUntil,
          azureActions,
          azureUsername: data.username
        })
      ]
    );

    return {
      success: true,
      enforced: true,
      reason,
      blockedUntil: nextBlockedUntil,
      azureActions
    };
  } catch (error) {
    console.error('[ENFORCEMENT] Error enforcing schedule violation:', error);
    return {
      success: false,
      enforced: false,
      message: error.message
    };
  }
}

const ENFORCEMENT_COOLDOWN_MS = 3 * 60 * 1000;

async function enforceBlockedAzureUsers() {
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
        au.status,
        r.enable_daily_usage,
        r.daily_limit_minutes,
        r.usage_schedule,
        r.enforce_in_azure
      FROM azure_users au
      JOIN requests r ON r.id = au.request_id
      WHERE r.enable_daily_usage = true
        AND r.enforce_in_azure = true
        AND COALESCE(au.is_deleted, false) = false
        AND au.status = 'Blocked'
        AND au.blocked_until IS NOT NULL
        AND au.blocked_until > NOW()
      `
    );

    if (result.rows.length === 0) {
      return { checked: 0, enforced: 0 };
    }

    let enforced = 0;

    for (const row of result.rows) {
      const access = evaluateUsageAccess({
        request: row,
        user: row,
        currentSessionMinutes: 0,
        at: new Date()
      });

      if (access.allowed) {
        continue;
      }

      const lastEnforcement = await db.query(
        `
        SELECT created_at
        FROM usage_enforcement_logs
        WHERE request_id = $1
          AND user_id = $2
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [row.request_id, row.id]
      );

      const lastEnforcedAt = lastEnforcement.rows[0]?.created_at
        ? new Date(lastEnforcement.rows[0].created_at).getTime()
        : 0;

      if (Date.now() - lastEnforcedAt < ENFORCEMENT_COOLDOWN_MS) {
        continue;
      }

      console.log(
        `[ENFORCEMENT] Re-checking blocked user ${row.id} (${row.username}) - ${access.reason}`
      );

      await revokeAzureAccess({
        azureUserId: row.azure_user_id,
        userId: row.id,
        requestId: row.request_id
      });

      await db.query(
        `
        INSERT INTO usage_enforcement_logs (
          request_id,
          user_id,
          action,
          details,
          created_at
        )
        VALUES ($1, $2, $3, $4, NOW())
        `,
        [
          row.request_id,
          row.id,
          `blocked_user_recheck_${access.reason}`,
          JSON.stringify({
            reason: access.reason,
            message: access.message,
            blockedUntil: row.blocked_until,
            azureUsername: row.username
          })
        ]
      );

      enforced += 1;
    }

    if (enforced > 0) {
      console.log(`[ENFORCEMENT] Re-revoked Azure access for ${enforced} blocked user(s).`);
    }

    return { checked: result.rows.length, enforced };
  } catch (error) {
    console.error('[ENFORCEMENT] Error re-checking blocked Azure users:', error.message);
    return { checked: 0, enforced: 0, error: error.message };
  }
}

module.exports = {
  enforceUsageLimit,
  enforceScheduleViolation,
  enforceBlockedAzureUsers,
  revokeAzureAccess,
  restoreAzureAccess
};
