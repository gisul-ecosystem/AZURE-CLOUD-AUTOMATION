const db = require('../db/postgres');
const adminAccessRequestService = require('./adminAccessRequestService');
const AppError = require('../utils/AppError');
const adminAuthService = require('./adminAuthService');
const managePortalService = require('./managePortalService');
const usageService = require('./usageService');
const { evaluateUsageAccess } = require('./usageAccessEvaluator');

const mapUserUsage = (row) => {
  const access = evaluateUsageAccess({
    request: {
      enable_daily_usage: row.enable_daily_usage,
      daily_limit_minutes: row.daily_limit_minutes,
      usage_schedule: row.usage_schedule
    },
    user: {
      used_today_minutes: row.used_today_minutes,
      blocked_until: row.blocked_until,
      last_reset_date: row.last_reset_date
    },
    currentSessionMinutes: Number(row.active_session_minutes || 0)
  });

  return {
    id: row.id,
    username: row.username,
    azureUserId: row.azure_user_id,
    status: row.status,
    createdAt: row.created_at,
    expiryDate: row.expiry_date,
    enableDailyUsage: row.enable_daily_usage === true,
    dailyLimitMinutes: Number(row.daily_limit_minutes || 0),
    usedTodayMinutes: Number(access.usedMinutes || 0),
    remainingMinutes: access.remainingMinutes,
    blockedUntil: row.blocked_until,
    hasActiveSession: Number(row.active_session_count || 0) > 0,
    lastLoginAt: row.last_login_at,
    roles: row.roles || []
  };
};

const login = async ({ email, username, password }) => {
  const admin = await adminAuthService.verifyOrgAdminCredentials({ email, username, password });
  const session = await adminAuthService.createOrgAdminSession(admin.id);

  return {
    admin,
    sessionToken: session.sessionToken,
    expiresAt: session.expiresAt
  };
};

const listResourceGroups = async () => {
  const result = await db.query(
    `
      SELECT
        r.id,
        r.customer_email,
        r.azure_resource_group_name,
        r.location,
        r.status,
        r.expiry_date,
        r.enable_daily_usage,
        r.daily_limit_minutes,
        r.usage_schedule,
        r.enforce_in_azure,
        r.created_at,
        COUNT(DISTINCT au.id) FILTER (WHERE COALESCE(au.is_deleted, false) = false) AS user_count,
        COUNT(DISTINCT uus.id) FILTER (WHERE uus.logout_at IS NULL) AS active_sessions
      FROM requests r
      LEFT JOIN azure_users au ON au.request_id = r.id
      LEFT JOIN user_usage_sessions uus ON uus.request_id = r.id
      WHERE r.azure_resource_group_name IS NOT NULL
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `
  );

  return result.rows.map((row) => ({
    requestId: row.id,
    customerEmail: row.customer_email,
    resourceGroup: row.azure_resource_group_name,
    location: row.location,
    status: row.status,
    expiryDate: row.expiry_date,
    enableDailyUsage: row.enable_daily_usage === true,
    dailyLimitMinutes: Number(row.daily_limit_minutes || 0),
    usageSchedule: row.usage_schedule,
    enforceInAzure: row.enforce_in_azure === true,
    createdAt: row.created_at,
    userCount: Number(row.user_count || 0),
    activeSessions: Number(row.active_sessions || 0)
  }));
};

const getResourceGroupDetail = async (requestId) => {
  const requestResult = await db.query(
    `
      SELECT
        r.id,
        r.customer_email,
        r.azure_resource_group_name,
        r.azure_resource_group_id,
        r.location,
        r.status,
        r.expiry_date,
        r.enable_daily_usage,
        r.daily_limit_minutes,
        r.usage_schedule,
        r.enforce_in_azure,
        r.estimated_price,
        r.created_at
      FROM requests r
      WHERE r.id = $1
      LIMIT 1
    `,
    [requestId]
  );

  const request = requestResult.rows[0];

  if (!request) {
    throw new AppError('Resource group request not found.', 404);
  }

  const usersResult = await db.query(
    `
      SELECT
        au.id,
        au.username,
        au.azure_user_id,
        au.status,
        au.created_at,
        au.used_today_minutes,
        au.blocked_until,
        au.last_reset_date,
        r.expiry_date,
        r.enable_daily_usage,
        r.daily_limit_minutes,
        r.usage_schedule,
        COUNT(uus.id) FILTER (WHERE uus.logout_at IS NULL) AS active_session_count,
        MAX(uus.login_at) AS last_login_at,
        COALESCE(
          SUM(
            CASE
              WHEN uus.logout_at IS NULL
                THEN EXTRACT(EPOCH FROM (NOW() - uus.login_at)) / 60
              ELSE 0
            END
          ),
          0
        ) AS active_session_minutes,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'role', ura.azure_role,
              'scope', ura.scope
            )
          ) FILTER (WHERE ura.azure_role IS NOT NULL),
          '[]'::json
        ) AS roles
      FROM azure_users au
      JOIN requests r ON r.id = au.request_id
      LEFT JOIN user_usage_sessions uus ON uus.request_id = au.request_id AND uus.user_id = au.id
      LEFT JOIN user_role_assignments ura ON ura.request_id = au.request_id AND ura.user_id = au.id
      WHERE au.request_id = $1
        AND COALESCE(au.is_deleted, false) = false
      GROUP BY
        au.id,
        au.username,
        au.azure_user_id,
        au.status,
        au.created_at,
        au.used_today_minutes,
        au.blocked_until,
        au.last_reset_date,
        r.expiry_date,
        r.enable_daily_usage,
        r.daily_limit_minutes,
        r.usage_schedule
      ORDER BY au.created_at DESC
    `,
    [requestId]
  );

  return {
    request: {
      requestId: request.id,
      customerEmail: request.customer_email,
      resourceGroup: request.azure_resource_group_name,
      resourceGroupId: request.azure_resource_group_id,
      location: request.location,
      status: request.status,
      expiryDate: request.expiry_date,
      enableDailyUsage: request.enable_daily_usage === true,
      dailyLimitMinutes: Number(request.daily_limit_minutes || 0),
      usageSchedule: request.usage_schedule,
      enforceInAzure: request.enforce_in_azure === true,
      estimatedPrice: request.estimated_price,
      createdAt: request.created_at
    },
    users: usersResult.rows.map(mapUserUsage)
  };
};

const getMonitoringLogs = async (requestId, { userId = null, limit = 50 } = {}) => {
  const resolvedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const resolvedUserId = userId ? Number(userId) : null;

  if (resolvedUserId && (!Number.isInteger(resolvedUserId) || resolvedUserId <= 0)) {
    throw new AppError('userId must be a positive integer.', 400);
  }

  const sessionParams = [requestId, resolvedLimit];
  let sessionFilter = '';

  if (resolvedUserId) {
    sessionParams.push(resolvedUserId);
    sessionFilter = 'AND uus.user_id = $3';
  }

  const sessionsResult = await db.query(
    `
      SELECT
        uus.id,
        uus.request_id,
        uus.user_id,
        au.username,
        uus.login_at,
        uus.logout_at,
        uus.minutes_used,
        CASE
          WHEN uus.logout_at IS NULL
            THEN FLOOR(EXTRACT(EPOCH FROM (NOW() - uus.login_at)) / 60)
          ELSE NULL
        END AS current_session_minutes
      FROM user_usage_sessions uus
      JOIN azure_users au ON au.id = uus.user_id AND au.request_id = uus.request_id
      WHERE uus.request_id = $1
        ${sessionFilter}
      ORDER BY uus.login_at DESC
      LIMIT $2
    `,
    sessionParams
  );

  const enforcementParams = [requestId, resolvedLimit];
  let enforcementFilter = '';

  if (resolvedUserId) {
    enforcementParams.push(resolvedUserId);
    enforcementFilter = 'AND uel.user_id = $3';
  }

  const enforcementResult = await db.query(
    `
      SELECT
        uel.id,
        uel.request_id,
        uel.user_id,
        au.username,
        uel.action,
        uel.details,
        uel.created_at
      FROM usage_enforcement_logs uel
      JOIN azure_users au ON au.id = uel.user_id AND au.request_id = uel.request_id
      WHERE uel.request_id = $1
        ${enforcementFilter}
      ORDER BY uel.created_at DESC
      LIMIT $2
    `,
    enforcementParams
  );

  const auditParams = [requestId, resolvedLimit];
  const auditResult = await db.query(
    `
      SELECT
        id,
        request_id,
        customer_email,
        actor,
        action,
        target_user_id,
        details,
        created_at
      FROM access_portal_audit_logs
      WHERE request_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    auditParams
  );

  return {
    usageSessions: sessionsResult.rows.map((row) => ({
      id: row.id,
      requestId: row.request_id,
      userId: row.user_id,
      username: row.username,
      loginAt: row.login_at,
      logoutAt: row.logout_at,
      minutesUsed: row.minutes_used !== null ? Number(row.minutes_used) : null,
      currentSessionMinutes:
        row.current_session_minutes !== null ? Number(row.current_session_minutes) : null,
      isActive: !row.logout_at
    })),
    enforcementLogs: enforcementResult.rows.map((row) => ({
      id: row.id,
      requestId: row.request_id,
      userId: row.user_id,
      username: row.username,
      action: row.action,
      details: row.details,
      createdAt: row.created_at
    })),
    auditLogs: auditResult.rows.map((row) => ({
      id: row.id,
      requestId: row.request_id,
      customerEmail: row.customer_email,
      actor: row.actor,
      action: row.action,
      targetUserId: row.target_user_id,
      details: row.details,
      createdAt: row.created_at
    }))
  };
};

const deleteUser = async ({ adminEmail, requestId, userId }) =>
  managePortalService.deletePortalUserByOrgAdmin({
    adminEmail,
    requestId,
    userId
  });

const updateUserRoles = async ({ adminEmail, requestId, userId, roles }) =>
  managePortalService.updatePortalUserRolesByOrgAdmin({
    adminEmail,
    requestId,
    userId,
    roles
  });

const forceLogoutUser = async ({ requestId, userId }) =>
  usageService.forceLogoutUser({
    requestId: Number(requestId),
    userId: Number(userId)
  });

const listAccessRequests = async ({ status, requestId } = {}) =>
  adminAccessRequestService.listAdminAccessRequests({ status, requestId });

const reviewAccessRequest = async ({ id, status, reviewNotes, reviewedBy }) =>
  adminAccessRequestService.reviewAdminAccessRequest({
    id,
    status,
    reviewNotes,
    reviewedBy
  });

module.exports = {
  login,
  listResourceGroups,
  getResourceGroupDetail,
  getMonitoringLogs,
  deleteUser,
  updateUserRoles,
  forceLogoutUser,
  listAccessRequests,
  reviewAccessRequest
};
