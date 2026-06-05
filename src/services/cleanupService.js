const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const {
  createCleanupClients,
  deleteResourceGroupWithRetry,
  deleteRoleAssignmentWithRetry,
  disableAzureUserWithRetry,
  logCleanupProvisionEvent
} = require('../provisioners/azure/cleanupProvisioner');
const { getUserRoleAssignmentsForRequest } = require('./roleProvisionService');
const { getUsersForRequest } = require('./userProvisionService');

const STATUS_EXPIRED = 'Expired';
const STATUS_COMPLETED = 'Completed';

const logCleanup = async (requestId, operation, status) => {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'cleanup-service',
    level: status,
    event: operation,
    requestId
  };

  const logMessage = JSON.stringify(entry);

  if (status === 'failed' || status === 'error') {
    console.error(logMessage);
  } else {
    console.log(logMessage);
  }

  try {
    await db.query(
      `
        INSERT INTO cleanup_logs (
          request_id,
          operation,
          status
        )
        VALUES ($1, $2, $3)
      `,
      [requestId, operation, status]
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        service: 'cleanup-service',
        level: 'error',
        event: 'cleanup_log_write_failed',
        requestId,
        message: error?.message
      })
    );
  }
};

const validateRequestId = (requestId) => {
  if (requestId === undefined || requestId === null || String(requestId).trim() === '') {
    throw new AppError('request_id is required.', 400);
  }
};

const getCleanupRequestForUpdate = async (client, requestId) => {
  const query = `
    SELECT
      id,
      status,
      customer_email,
      location,
      azure_resource_group_name,
      expired,
      cleanup_completed,
      expiry_date
    FROM requests
    WHERE id = $1
    FOR UPDATE
  `;

  const result = await client.query(query, [requestId]);
  return result.rows[0] || null;
};

const getCleanupRequestSummary = async (requestId) => {
  const query = `
    SELECT
      id,
      status,
      azure_resource_group_name,
      expired,
      cleanup_completed
    FROM requests
    WHERE id = $1
  `;

  const result = await db.query(query, [requestId]);
  return result.rows[0] || null;
};

const getRequestsDueForCleanup = async () => {
  const query = `
    SELECT id
    FROM requests
    WHERE expiry_date <= CURRENT_DATE
      AND COALESCE(expired, false) = false
      AND COALESCE(cleanup_completed, false) = false
    ORDER BY expiry_date ASC, id ASC
  `;

  const result = await db.query(query);
  return result.rows.map((row) => row.id);
};

const markRequestExpired = async (client, requestId) => {
  const query = `
    UPDATE requests
    SET
      status = $2,
      expired = TRUE,
      cleanup_completed = TRUE
    WHERE id = $1
    RETURNING id, status, expired, cleanup_completed
  `;

  const result = await client.query(query, [requestId, STATUS_EXPIRED]);
  return result.rows[0];
};

const cleanupRequestById = async (requestId, trigger = 'manual') => {
  validateRequestId(requestId);

  const client = await db.connect();
  let request = null;
  let roleAssignments = [];
  let azureUsers = [];

  try {
    await client.query('BEGIN');

    request = await getCleanupRequestForUpdate(client, requestId);

    if (!request) {
      throw new AppError('Request not found.', 404);
    }

    if (request.expired && request.cleanup_completed) {
      await client.query('COMMIT');

      await logCleanup(requestId, 'cleanup_completed', 'success');

      return {
        expired: true,
        cleanupCompleted: true,
        resourceGroup: request.azure_resource_group_name || null,
        status: request.status
      };
    }

    roleAssignments = await getUserRoleAssignmentsForRequest(requestId);
    azureUsers = await getUsersForRequest(requestId);

    await client.query('COMMIT');

    await logCleanup(requestId, 'cleanup_started', 'success');

    const { authorizationClient, resourceClient, graphClient, subscriptionId } =
      createCleanupClients();

    let rolesRemoved = 0;
    for (const assignment of roleAssignments) {
      const removed = await deleteRoleAssignmentWithRetry(
        authorizationClient,
        assignment.scope,
        assignment.assignmentId,
        requestId
      );

      if (removed) {
        rolesRemoved += 1;
      }
    }

    await logCleanup(requestId, 'roles_removed', 'success');

    let usersDisabled = 0;
    for (const user of azureUsers) {
      const disabled = await disableAzureUserWithRetry(graphClient, user.azureUserId, requestId);
      if (disabled) {
        usersDisabled += 1;
      }
    }

    await logCleanup(requestId, 'users_disabled', 'success');

    let resourceGroupDeleted = false;
    if (request.azure_resource_group_name) {
      resourceGroupDeleted = await deleteResourceGroupWithRetry(
        resourceClient,
        request.azure_resource_group_name,
        requestId
      );
    }

    await logCleanup(requestId, 'resource_group_deleted', 'success');

    const finalizeClient = await db.connect();

    try {
      await finalizeClient.query('BEGIN');
      const updatedRequest = await markRequestExpired(finalizeClient, requestId);
      await finalizeClient.query('COMMIT');

      await logCleanup(requestId, 'cleanup_completed', 'success');

      return {
        expired: updatedRequest.expired,
        cleanupCompleted: updatedRequest.cleanup_completed,
        resourceGroup: request.azure_resource_group_name || null,
        status: updatedRequest.status,
        rolesRemoved,
        usersDisabled,
        resourceGroupDeleted
      };
    } catch (error) {
      await finalizeClient.query('ROLLBACK');
      throw error;
    } finally {
      finalizeClient.release();
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      await logCleanup(requestId, 'cleanup_rollback_failed', 'failed');
    }

    await logCleanup(requestId, 'cleanup_failed', 'failed');

    throw error;
  } finally {
    client.release();
  }
};

const getCleanupStatus = async (requestId) => {
  validateRequestId(requestId);

  const request = await getCleanupRequestSummary(requestId);

  if (!request) {
    return null;
  }

  return {
    requestId: request.id,
    status: request.status,
    resourceGroup: request.azure_resource_group_name || null,
    expired: Boolean(request.expired),
    cleanupCompleted: Boolean(request.cleanup_completed)
  };
};

const cleanupExpiredRequests = async () => {
  const requestIds = await getRequestsDueForCleanup();
  const results = [];

  for (const requestId of requestIds) {
    try {
      const result = await cleanupRequestById(requestId, 'scheduler');
      results.push({ requestId, ...result, success: true });
    } catch (error) {
      results.push({
        requestId,
        success: false,
        message: error?.message
      });
    }
  }

  return results;
};

module.exports = {
  cleanupExpiredRequests,
  cleanupRequestById,
  getCleanupStatus,
  logCleanup
};
