const { Client } = require('@microsoft/microsoft-graph-client');
const { ClientSecretCredential } = require('@azure/identity');
const { createAzureCredential, validateAzureEnv } = require('../config/azure');
const db = require('../db/postgres');
const AppError = require('../utils/AppError');

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
      console.log(`[ACCOUNT_DISABLED] Azure account disabled for user ${azureUserId}`);
      actions.push({ action: 'disable_account', status: 'success' });
    } catch (error) {
      console.error(`[AZURE_REVOKE] Error disabling account: ${error.message}`);
      actions.push({ action: 'disable_account', status: 'failed', error: error.message });
    }

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
        au.azure_username,
        au.used_today_minutes,
        r.daily_limit_minutes
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
    const limitMinutes = Number(data.daily_limit_minutes || 0);

    if (usedMinutes < limitMinutes) {
      console.log(`[ENFORCEMENT] User ${userId} has not exceeded limit. Skipping enforcement.`);
      return {
        success: true,
        message: 'User has not exceeded daily limit.',
        enforced: false
      };
    }

    console.log(
      `[ENFORCEMENT] User ${userId} (${data.azure_username}) exceeded limit: ${usedMinutes}/${limitMinutes} minutes`
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
          azureUsername: data.azure_username,
          message: 'Azure sessions revoked and account disabled. RBAC preserved.'
        })
      ]
    );

    console.log(
      `[ENFORCEMENT] Azure access revoked for user ${userId} (${data.azure_username}). ` +
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

module.exports = {
  enforceUsageLimit,
  revokeAzureAccess,
  restoreAzureAccess
};
