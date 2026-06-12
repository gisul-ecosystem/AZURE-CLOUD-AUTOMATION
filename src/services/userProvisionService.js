const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const {
  buildUserPayload,
  createGraphClient,
  createGraphUserWithRetry,
  getVerifiedDomain,
  logAzureUserEvent
} = require('../provisioners/azure/userProvisioner');
const { runWithConcurrency } = require('../utils/concurrency');
const { evaluateUsageAccess } = require('./usageAccessEvaluator');

const STATUS_CREATED = 'Created';
const DEFAULT_CONCURRENCY = Math.max(1, Number(process.env.BULK_PROVISION_CONCURRENCY || 20));
const STATUS_BLOCKED = 'Blocked';

const getRequestByIdForUserProvisioning = async (client, requestId) => {
  const query = `
    SELECT
      id,
      account_count,
      status,
      expiry_date,
      enable_daily_usage,
      daily_limit_minutes,
      usage_schedule,
      enforce_in_azure
    FROM requests
    WHERE id = $1
    FOR UPDATE
  `;

  const result = await client.query(query, [requestId]);
  return result.rows[0] || null;
};

const getExistingUsersForRequest = async (requestId) => {
  const query = `
    SELECT request_id, azure_user_id, username, status
    FROM azure_users
    WHERE request_id = $1
    ORDER BY username ASC
  `;

  const result = await db.query(query, [requestId]);
  return result.rows;
};

const getInitialScheduleAccess = (request) => {
  if (!request?.enable_daily_usage) {
    return {
      allowed: true,
      status: STATUS_CREATED,
      blockedUntil: null,
      disableAzureAccount: false,
      reason: null,
      message: null
    };
  }

  const access = evaluateUsageAccess({
    request,
    user: {
      used_today_minutes: 0,
      blocked_until: null,
      last_reset_date: null
    },
    currentSessionMinutes: 0
  });

  if (access.allowed) {
    return {
      allowed: true,
      status: STATUS_CREATED,
      blockedUntil: null,
      disableAzureAccount: false,
      reason: access.reason,
      message: access.message
    };
  }

  return {
    allowed: false,
    status: STATUS_BLOCKED,
    blockedUntil: access.blockedUntil || null,
    disableAzureAccount: request.enforce_in_azure === true,
    reason: access.reason,
    message: access.message
  };
};

const insertAzureUsers = async (client, requestId, createdUsers) => {
  const insertQuery = `
    INSERT INTO azure_users (
      request_id,
      azure_user_id,
      username,
      temporary_password,
      status,
      blocked_until
    )
    VALUES ($1, $2, $3, $4, $5, $6)
  `;

  for (const user of createdUsers) {
    await client.query(insertQuery, [
      requestId,
      user.azureUserId,
      user.username,
      user.temporaryPassword,
      user.status,
      user.blockedUntil
    ]);
  }
};

const provisionUsersForRequest = async (requestId) => {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const request = await getRequestByIdForUserProvisioning(client, requestId);

    if (!request) {
      throw new AppError('Request not found.', 404);
    }

    const accountCount = Number(request.account_count);

    if (!Number.isInteger(accountCount) || accountCount <= 0) {
      throw new AppError('Request account count is invalid.', 400);
    }

    const existingUsers = await getExistingUsersForRequest(requestId);

    if (existingUsers.length === accountCount) {
      await client.query('COMMIT');

      logAzureUserEvent('info', 'azure_user_provision_reused_existing', {
        requestId,
        usersCreated: existingUsers.length
      });

      return {
        usersCreated: existingUsers.length
      };
    }

    if (existingUsers.length > 0 && existingUsers.length !== accountCount) {
      throw new AppError(
        'Partial Azure user provisioning exists for this request. Manual review is required.',
        409
      );
    }

    const { graphClient, subscriptionId } = createGraphClient();
    const verifiedDomain = await getVerifiedDomain(graphClient);

    const initialAccess = getInitialScheduleAccess(request);

    logAzureUserEvent('info', 'azure_user_provision_started', {
      requestId,
      subscriptionId,
      accountCount,
      verifiedDomain,
      scheduleAccessAllowed: initialAccess.allowed,
      scheduleAccessReason: initialAccess.reason,
      azureAccountDisabledAtCreation: initialAccess.disableAzureAccount
    });

    const createdUsers = [];

    const userNumbers = Array.from({ length: accountCount }, (_, index) => index + 1);
    await runWithConcurrency(userNumbers, DEFAULT_CONCURRENCY, async (userNumber) => {
      const { username, temporaryPassword, payload } = buildUserPayload({
        requestId,
        userNumber,
        domain: verifiedDomain,
        accountEnabled: !initialAccess.disableAzureAccount
      });

      const createdUser = await createGraphUserWithRetry(graphClient, payload, requestId);

      createdUsers.push({
        azureUserId: createdUser.id,
        username,
        temporaryPassword,
        status: initialAccess.status,
        blockedUntil: initialAccess.blockedUntil
      });
    });

    await insertAzureUsers(client, requestId, createdUsers);

    await client.query('COMMIT');

    logAzureUserEvent('info', 'azure_user_provision_success', {
      requestId,
      subscriptionId,
      usersCreated: createdUsers.length
    });

    return {
      usersCreated: createdUsers.length
    };
  } catch (error) {
    await client.query('ROLLBACK');

    logAzureUserEvent('error', 'azure_user_provision_failed', {
      requestId,
      errorName: error?.name,
      errorCode: error?.code,
      statusCode: error?.statusCode || error?.status,
      message: error?.message
    });

    throw error;
  } finally {
    client.release();
  }
};

const getUsersForRequest = async (requestId) => {
  const query = `
    SELECT
      u.id,
      u.azure_user_id,
      u.username,
      u.status,
      u.created_at,
      r.expiry_date
    FROM azure_users u
    LEFT JOIN requests r
      ON r.id = u.request_id
    WHERE u.request_id = $1
    ORDER BY u.created_at DESC
  `;

  const result = await db.query(query, [requestId]);

  return result.rows.map((row) => ({
    id: row.id,
    azureUserId: row.azure_user_id,
    username: row.username,
    status: row.status,
    createdAt: row.created_at,
    expiryDate: row.expiry_date
  }));
};

module.exports = {
  getUsersForRequest,
  provisionUsersForRequest
};
