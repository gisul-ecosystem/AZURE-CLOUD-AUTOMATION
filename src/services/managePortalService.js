const crypto = require('crypto');
const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const adminAuthService = require('./adminAuthService');
const { createGraphClient } = require('../provisioners/azure/userProvisioner');
const {
  buildResourceGroupScope,
  createAuthorizationClient,
  createRoleAssignmentWithRetry,
  findMatchingRoleDefinition,
  getExistingAzureAssignment,
  logAzureRoleEvent,
  roleAssignmentIdFromSeed
} = require('../provisioners/azure/roleProvisioner');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';
const ACCESS_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sha256Hex = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');

const normalizeRoles = (roles = []) =>
  Array.from(
    new Set(
      (Array.isArray(roles) ? roles : [])
        .map((role) => String(role || '').trim())
        .filter(Boolean)
    )
  );

const toDateOnlyString = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
};

const logManagePortalEvent = (level, event, details = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'manage-portal',
    level,
    event,
    ...details
  };

  const message = JSON.stringify(entry);

  if (level === 'error') {
    console.error(message);
    return;
  }

  console.log(message);
};

const recordAuditLog = async (
  client,
  { requestId = null, customerEmail = null, actor = 'customer', action, targetUserId = null, details = null }
) => {
  try {
    await client.query(
      `
        INSERT INTO access_portal_audit_logs (
          request_id,
          customer_email,
          actor,
          action,
          target_user_id,
          details
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        requestId,
        customerEmail,
        actor,
        action,
        targetUserId,
        details ? JSON.stringify(details) : null
      ]
    );
  } catch (error) {
    logManagePortalEvent('error', 'audit_log_write_failed', {
      requestId,
      customerEmail,
      actor,
      action,
      targetUserId,
      message: error?.message
    });
  }
};

const recordCleanupLog = async (client, { requestId, eventName, logLevel, message, details = null }) => {
  try {
    await client.query(
      `
        INSERT INTO cleanup_logs (
          request_id,
          event_name,
          log_level,
          message,
          details_json
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        requestId,
        eventName,
        logLevel,
        message,
        details ? JSON.stringify(details) : null
      ]
    );
  } catch (error) {
    logManagePortalEvent('error', 'cleanup_log_write_failed', {
      requestId,
      eventName,
      message: error?.message
    });
  }
};

const getRequestContext = async (requestId) => {
  const query = `
    SELECT
      r.id,
      r.customer_email,
      r.expiry_date,
      r.status,
      COUNT(u.id) AS user_count
    FROM requests r
    LEFT JOIN azure_users u
      ON u.request_id = r.id
      AND COALESCE(u.is_deleted, false) = false
    WHERE r.id = $1
    GROUP BY r.id
    LIMIT 1
  `;

  const result = await db.query(query, [requestId]);

  if (!result.rows.length) {
    return null;
  }

  return result.rows[0];
};

const getRequestResourceGroupName = async (requestId) => {
  const result = await db.query(
    `
      SELECT azure_resource_group_name
      FROM requests
      WHERE id = $1
      LIMIT 1
    `,
    [requestId]
  );

  return result.rows[0]?.azure_resource_group_name || null;
};

const getPortalSessionByToken = async (sessionToken) => {
  const sessionHash = sha256Hex(sessionToken);
  const result = await db.query(
    `
      SELECT
        aps.id AS session_id,
        aps.token_id,
        aps.request_id,
        aps.customer_email,
        aps.expires_at,
        aps.revoked,
        apt.used
      FROM access_portal_sessions aps
      INNER JOIN access_portal_tokens apt
        ON apt.id = aps.token_id
      WHERE aps.session_hash = $1
        AND aps.revoked = false
        AND aps.expires_at > NOW()
    `,
    [sessionHash]
  );

  return result.rows[0] || null;
};

const requireSession = async (sessionToken) => {
  const token = String(sessionToken || '').trim();

  if (!token) {
    throw new AppError('Access session is required.', 401);
  }

  const session = await getPortalSessionByToken(token);

  if (!session) {
    throw new AppError('Access session is invalid or expired.', 401);
  }

  return session;
};

const validateSessionForRequest = (session, requestId) => {
  if (String(session.request_id) !== String(requestId)) {
    throw new AppError('Access session does not match this request.', 403);
  }
};

const buildManageUrl = (token) => {
  const baseUrl = FRONTEND_URL.replace(/\/+$/, '');
  return `${baseUrl}/manage-users?token=${encodeURIComponent(token)}`;
};

const getManageUsersForRequest = async (client, requestId) => {
  const usersResult = await client.query(
    `
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
    `,
    [requestId]
  );

  const rolesResult = await client.query(
    `
      SELECT
        ura.user_id,
        ura.azure_role,
        ura.scope
      FROM user_role_assignments ura
      WHERE ura.request_id = $1
      ORDER BY ura.created_at ASC
    `,
    [requestId]
  );

  const rolesByUserId = new Map();

  for (const row of rolesResult.rows) {
    const userId = String(row.user_id);
    const current = rolesByUserId.get(userId) || [];
    current.push({
      role: row.azure_role,
      scope: row.scope
    });
    rolesByUserId.set(userId, current);
  }

  return usersResult.rows.map((row) => ({
    id: row.id,
    username: row.username,
    azureUserId: row.azure_user_id,
    status: row.status,
    expiryDate: toDateOnlyString(row.expiry_date),
    roles: rolesByUserId.get(String(row.id)) || []
  }));
};

const issueAccessPortalTokenForRequest = async (requestId) => {
  const request = await getRequestContext(requestId);

  if (!request) {
    throw new AppError('Request not found.', 404);
  }

  const rawToken = crypto.randomUUID();
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
  const adminCredentials = await adminAuthService.issueTemporaryAdminCredentials({
    email: request.customer_email,
    name: request.customer_email
  });

  const tokenInsert = `
    INSERT INTO access_portal_tokens(
      id,
      request_id,
      customer_email,
      token_hash,
      expires_at
    )
    VALUES(
      gen_random_uuid(),
      $1,
      $2,
      $3,
      NOW() + INTERVAL '7 days'
    )
    RETURNING id
  `;

  await db.query(tokenInsert, [
    request.id,
    request.customer_email,
    tokenHash
  ]);

  await recordAuditLog(db, {
    requestId,
    customerEmail: request.customer_email,
    actor: 'system',
    action: 'portal_token_issued',
    details: {
      expiresAt: expiresAt.toISOString()
    }
  });

  const manageUrl = buildManageUrl(rawToken);

  logManagePortalEvent('info', 'portal_token_issued', {
    requestId,
    customerEmail: request.customer_email,
    expiresAt: expiresAt.toISOString()
  });

  return {
    requestId,
    customerEmail: request.customer_email,
    adminCredentials,
    resourceGroup: null,
    manageUrl,
    expiresAt
  };
};

const exchangeAccessToken = async (rawToken, credentials = {}) => {
  const token = String(rawToken || '').trim();

  if (!token) {
    throw new AppError('token is required.', 400);
  }

  const tokenHash = sha256Hex(token);
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const tokenResult = await client.query(
      `
        SELECT
          id,
          request_id,
          customer_email,
          expires_at,
          used
        FROM access_portal_tokens
        WHERE token_hash = $1
        FOR UPDATE
      `,
      [tokenHash]
    );

    const portalToken = tokenResult.rows[0] || null;

    if (!portalToken) {
      throw new AppError('Access link is invalid.', 401);
    }

    if (portalToken.used) {
      throw new AppError('Access link has already been used.', 401);
    }

    if (new Date(portalToken.expires_at).getTime() <= Date.now()) {
      throw new AppError('Access link has expired.', 401);
    }

    const admin = await adminAuthService.verifyAdminCredentials({
      email: portalToken.customer_email,
      username: credentials.username,
      password: credentials.password
    });

    const sessionToken = crypto.randomUUID();
    const sessionHash = sha256Hex(sessionToken);
    const sessionExpiresAt = new Date(portalToken.expires_at);

    await client.query(
      `
        UPDATE access_portal_tokens
        SET used = true,
            used_at = NOW()
        WHERE id = $1
      `,
      [portalToken.id]
    );

    await client.query(
      `
        INSERT INTO access_portal_sessions (
          id,
          token_id,
          request_id,
          customer_email,
          session_hash,
          expires_at,
          revoked
        )
        VALUES ($1, $2, $3, $4, $5, $6, false)
      `,
      [
        crypto.randomUUID(),
        portalToken.id,
        portalToken.request_id,
        portalToken.customer_email,
        sessionHash,
        sessionExpiresAt
      ]
    );

    const resourceGroup = await getRequestResourceGroupName(portalToken.request_id);

    // Get the first azure user for this request to enable auto-session start
    const userResult = await client.query(
      `
        SELECT id
        FROM azure_users
        WHERE request_id = $1
          AND COALESCE(is_deleted, false) = false
        ORDER BY created_at ASC
        LIMIT 1
      `,
      [portalToken.request_id]
    );

    const userId = userResult.rows[0]?.id || null;

    await recordAuditLog(client, {
      requestId: portalToken.request_id,
      customerEmail: portalToken.customer_email,
      actor: 'customer',
      action: 'portal_token_consumed',
      details: {
        expiresAt: sessionExpiresAt.toISOString(),
        userId,
        adminId: admin.id,
        adminUsername: admin.username
      }
    });

    await client.query('COMMIT');

    logManagePortalEvent('info', 'portal_token_consumed', {
      requestId: portalToken.request_id,
      customerEmail: portalToken.customer_email,
      userId,
      adminId: admin.id
    });

    return {
      requestId: portalToken.request_id,
      customerEmail: portalToken.customer_email,
      admin,
      resourceGroup,
      sessionToken,
      expiresAt: sessionExpiresAt,
      userId
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const listPortalUsers = async (sessionToken, requestId) => {
  const session = await requireSession(sessionToken);
  validateSessionForRequest(session, requestId);

  const request = await getRequestContext(requestId);
  if (!request) {
    throw new AppError('Request not found.', 404);
  }

  const users = await getManageUsersForRequest(db, requestId);

  await recordAuditLog(db, {
    requestId,
    customerEmail: session.customer_email,
    actor: 'customer',
    action: 'manage_request_loaded',
    details: {
      userCount: users.length
    }
  });

  return {
    requestId: Number(requestId),
    users
  };
};

const getRequestPrimaryScope = async (client, requestId) => {
  const resourceGroupName = await getRequestResourceGroupName(requestId);

  if (!resourceGroupName) {
    throw new AppError('Request does not have a provisioned resource group.', 400);
  }

  const { subscriptionId } = createAuthorizationClient();
  return buildResourceGroupScope(subscriptionId, String(resourceGroupName).trim());
};

const getPortalUserRecord = async (client, requestId, userId) => {
  const result = await client.query(
    `
      SELECT
        id,
        request_id,
        azure_user_id,
        username,
        status
      FROM azure_users
      WHERE request_id = $1
        AND id = $2
      LIMIT 1
    `,
    [requestId, userId]
  );

  return result.rows[0] || null;
};

const getPortalAssignmentsForUser = async (client, requestId, userId) => {
  const result = await client.query(
    `
      SELECT
        assignment_id,
        scope,
        azure_role
      FROM user_role_assignments
      WHERE request_id = $1
        AND user_id = $2
      ORDER BY created_at ASC
    `,
    [requestId, userId]
  );

  return result.rows;
};

const deleteAzureUserWithRetry = async (graphClient, azureUserId, requestId) => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await graphClient.api(`/users/${encodeURIComponent(azureUserId)}`).delete();
      return true;
    } catch (error) {
      lastError = error;
      const statusCode = Number(error?.statusCode || error?.status);
      const errorCode = String(error?.code || '').toUpperCase();

      if (
        statusCode === 404 ||
        (attempt === MAX_ATTEMPTS &&
          !RETRYABLE_STATUS_CODES.has(statusCode) &&
          !['ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'REQUESTTIMEOUT'].includes(errorCode))
      ) {
        if (statusCode === 404) {
          return false;
        }

        throw error;
      }

      const delayMs = 500 * 2 ** (attempt - 1);

      logAzureRoleEvent('info', 'portal_user_delete_retry', {
        requestId,
        azureUserId,
        attempt,
        nextDelayMs: delayMs,
        errorName: error?.name,
        errorCode: error?.code,
        statusCode: error?.statusCode || error?.status,
        message: error?.message
      });

      await sleep(delayMs);
    }
  }

  throw lastError;
};

const deleteRoleAssignmentWithRetry = async (authorizationClient, scope, assignmentId, requestId) => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await authorizationClient.roleAssignments.delete(scope, assignmentId);
      return true;
    } catch (error) {
      lastError = error;
      const statusCode = Number(error?.statusCode || error?.status);
      const errorCode = String(error?.code || '').toUpperCase();

      if (
        statusCode === 404 ||
        (attempt === MAX_ATTEMPTS &&
          !RETRYABLE_STATUS_CODES.has(statusCode) &&
          !['ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'REQUESTTIMEOUT'].includes(errorCode))
      ) {
        if (statusCode === 404) {
          return false;
        }

        throw error;
      }

      const delayMs = 500 * 2 ** (attempt - 1);

      logAzureRoleEvent('info', 'portal_role_delete_retry', {
        requestId,
        scope,
        assignmentId,
        attempt,
        nextDelayMs: delayMs,
        errorName: error?.name,
        errorCode: error?.code,
        statusCode: error?.statusCode || error?.status,
        message: error?.message
      });

      await sleep(delayMs);
    }
  }

  throw lastError;
};

const revokeAssignmentsForUser = async (authorizationClient, assignments, requestId) => {
  for (const assignment of assignments) {
    await deleteRoleAssignmentWithRetry(authorizationClient, assignment.scope, assignment.assignment_id, requestId);
  }
};

const deletePortalUser = async (sessionToken, requestId, userId) => {
  const session = await requireSession(sessionToken);
  validateSessionForRequest(session, requestId);

  const targetUserId = String(userId || '').trim();
  if (!targetUserId) {
    throw new AppError('User id is required.', 400);
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const request = await getRequestContext(requestId);
    const user = await getPortalUserRecord(client, requestId, targetUserId);

    if (!request || !user) {
      throw new AppError('User not found.', 404);
    }

    const assignments = await getPortalAssignmentsForUser(client, requestId, targetUserId);
    const { authorizationClient } = createAuthorizationClient();

    if (assignments.length > 0) {
      await revokeAssignmentsForUser(authorizationClient, assignments, requestId);
    }

    try {
      const { graphClient } = createGraphClient();
      await deleteAzureUserWithRetry(graphClient, user.azure_user_id, requestId);
    } catch (error) {
      logManagePortalEvent('error', 'portal_user_delete_failed', {
        requestId,
        userId: targetUserId,
        azureUserId: user.azure_user_id,
        message: error?.message
      });
      throw error;
    }

    await client.query(
      `
        DELETE FROM user_role_assignments
        WHERE request_id = $1
          AND user_id = $2
      `,
      [requestId, targetUserId]
    );

    await client.query(
      `
        DELETE FROM azure_users
        WHERE request_id = $1
          AND id = $2
      `,
      [requestId, targetUserId]
    );

    await recordCleanupLog(client, {
      requestId,
      eventName: 'manage_user_deleted',
      logLevel: 'info',
      message: `Deleted Azure user ${user.azure_user_id} for request ${requestId}.`,
      details: {
        userId: targetUserId,
        azureUserId: user.azure_user_id,
        assignmentsRemoved: assignments.length
      }
    });

    await recordAuditLog(client, {
      requestId,
      customerEmail: session.customer_email,
      actor: 'customer',
      action: 'manage_user_deleted',
      targetUserId,
      details: {
        azureUserId: user.azure_user_id,
        assignmentsRemoved: assignments.length
      }
    });

    await client.query('COMMIT');

    return {
      id: targetUserId,
      azureUserId: user.azure_user_id,
      deleted: true
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const updatePortalUserRoles = async (sessionToken, requestId, userId, roles) => {
  const session = await requireSession(sessionToken);
  validateSessionForRequest(session, requestId);

  const targetUserId = String(userId || '').trim();
  const normalizedRoles = normalizeRoles(roles);

  if (!targetUserId) {
    throw new AppError('User id is required.', 400);
  }

  if (normalizedRoles.length === 0) {
    throw new AppError('roles must be a non-empty array.', 400);
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const request = await getRequestContext(requestId);
    const user = await getPortalUserRecord(client, requestId, targetUserId);

    if (!request || !user) {
      throw new AppError('User not found.', 404);
    }

    const scope = await getRequestPrimaryScope(client, requestId);
    const currentAssignments = await getPortalAssignmentsForUser(client, requestId, targetUserId);
    const { authorizationClient } = createAuthorizationClient();

    if (currentAssignments.length > 0) {
      await revokeAssignmentsForUser(authorizationClient, currentAssignments, requestId);
    }

    await client.query(
      `
        DELETE FROM user_role_assignments
        WHERE request_id = $1
          AND user_id = $2
      `,
      [requestId, targetUserId]
    );

    const assignedRoles = [];

    for (const roleName of normalizedRoles) {
      const roleDefinition = await findMatchingRoleDefinition(authorizationClient, scope, roleName);

      if (!roleDefinition?.id) {
        throw new AppError(`Unable to resolve Azure role "${roleName}" at the resource group scope.`, 404);
      }

      const assignmentSeed = [requestId, targetUserId, roleDefinition.id, scope].join(':');
      const assignmentId = roleAssignmentIdFromSeed(assignmentSeed);
      const existingAzureAssignment = await getExistingAzureAssignment(authorizationClient, scope, assignmentId);

      if (!existingAzureAssignment) {
        await createRoleAssignmentWithRetry(
          authorizationClient,
          scope,
          assignmentId,
          {
            principalId: user.azure_user_id,
            roleDefinitionId: roleDefinition.id,
            principalType: 'User'
          },
          requestId
        );
      }

      await client.query(
        `
          INSERT INTO user_role_assignments (
            assignment_id,
            request_id,
            user_id,
            azure_role,
            scope,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, NOW())
        `,
        [
          assignmentId,
          requestId,
          targetUserId,
          roleName,
          scope
        ]
      );

      assignedRoles.push({
        role: roleName,
        scope
      });
    }

    await recordAuditLog(client, {
      requestId,
      customerEmail: session.customer_email,
      actor: 'customer',
      action: 'manage_user_roles_updated',
      targetUserId,
      details: {
        roles: assignedRoles
      }
    });

    await client.query('COMMIT');

    logManagePortalEvent('info', 'manage_user_roles_updated', {
      requestId,
      userId: targetUserId,
      roles: assignedRoles.length
    });

    return {
      id: targetUserId,
      azureUserId: user.azure_user_id,
      roles: assignedRoles
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  deletePortalUser,
  exchangeAccessToken,
  issueAccessPortalTokenForRequest,
  listPortalUsers,
  requireSession,
  updatePortalUserRoles
};
