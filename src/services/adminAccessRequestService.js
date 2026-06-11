const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const roleProvisionService = require('./roleProvisionService');
const { sendAdminAccessDecisionEmail } = require('./email/adminAccessRequestEmailService');

const mapRow = (row) => ({
  id: row.id,
  requestId: row.request_id,
  customerEmail: row.customer_email,
  serviceId: row.service_id,
  serviceName: row.service_name,
  defaultRole: row.default_role,
  requestedAccess: row.requested_access,
  accountCount: row.account_count ? Number(row.account_count) : null,
  status: row.status,
  reviewedBy: row.reviewed_by,
  reviewedAt: row.reviewed_at,
  reviewNotes: row.review_notes,
  createdAt: row.created_at
});

const logAdminAccessEvent = (level, event, details = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'admin-access-request',
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

const resolveRolesForAccessRequest = async ({ serviceId, requestedAccess, defaultRole }) => {
  const sid = Number(serviceId);
  const accessText = String(requestedAccess || '').trim();

  const mappingResult = await db.query(
    `
      SELECT azure_role
      FROM service_role_mapping
      WHERE service_id = $1
      ORDER BY azure_role
    `,
    [sid]
  );

  const availableRoles = mappingResult.rows.map((row) => row.azure_role);
  const matchedRoles = new Set();

  if (defaultRole) {
    matchedRoles.add(String(defaultRole).trim());
  }

  const tokens = accessText
    .split(/[,;\n]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const normalizedToken = token.toLowerCase();

    for (const role of availableRoles) {
      const normalizedRole = role.toLowerCase();

      if (
        normalizedRole === normalizedToken ||
        normalizedRole.includes(normalizedToken) ||
        normalizedToken.includes(normalizedRole)
      ) {
        matchedRoles.add(role);
      }
    }
  }

  if (matchedRoles.size <= (defaultRole ? 1 : 0)) {
    const lowerAccessText = accessText.toLowerCase();

    for (const role of availableRoles) {
      if (lowerAccessText.includes(role.toLowerCase())) {
        matchedRoles.add(role);
      }
    }
  }

  return Array.from(matchedRoles).filter(Boolean);
};

const findProvisionedRequestId = async ({ requestId, customerEmail, serviceId }) => {
  const parsedRequestId = Number(requestId);

  if (Number.isInteger(parsedRequestId) && parsedRequestId > 0) {
    return parsedRequestId;
  }

  const email = String(customerEmail || '').trim().toLowerCase();
  const sid = Number(serviceId);

  if (!email || !Number.isInteger(sid) || sid <= 0) {
    return null;
  }

  const result = await db.query(
    `
      SELECT r.id
      FROM requests r
      JOIN request_services rs ON rs.request_id = r.id
      WHERE lower(r.customer_email) = $1
        AND rs.service_id = $2
        AND r.azure_resource_group_name IS NOT NULL
      ORDER BY r.created_at DESC
      LIMIT 1
    `,
    [email, sid]
  );

  return result.rows[0]?.id || null;
};

const persistApprovedRolesToRequest = async (client, requestId, serviceId, roles) => {
  for (const role of roles) {
    await client.query(
      `
        INSERT INTO request_service_roles (
          request_id,
          service_id,
          azure_role
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (request_id, service_id, azure_role)
        DO NOTHING
      `,
      [requestId, serviceId, role]
    );
  }
};

const requestHasProvisionedUsers = async (requestId) => {
  const result = await db.query(
    `
      SELECT COUNT(*)::int AS user_count
      FROM azure_users
      WHERE request_id = $1
        AND COALESCE(is_deleted, false) = false
    `,
    [requestId]
  );

  return Number(result.rows[0]?.user_count || 0) > 0;
};

const requestHasResourceGroup = async (requestId) => {
  const result = await db.query(
    `
      SELECT azure_resource_group_name
      FROM requests
      WHERE id = $1
      LIMIT 1
    `,
    [requestId]
  );

  return Boolean(String(result.rows[0]?.azure_resource_group_name || '').trim());
};

const applyApprovedRolesForRequest = async (accessRequest) => {
  const grantedRoles = await resolveRolesForAccessRequest({
    serviceId: accessRequest.serviceId,
    requestedAccess: accessRequest.requestedAccess,
    defaultRole: accessRequest.defaultRole
  });

  if (grantedRoles.length === 0) {
    throw new AppError(
      'Unable to resolve Azure roles from the requested access. Review the request and try again.',
      400
    );
  }

  const resolvedRequestId = await findProvisionedRequestId({
    requestId: accessRequest.requestId,
    customerEmail: accessRequest.customerEmail,
    serviceId: accessRequest.serviceId
  });

  if (!resolvedRequestId) {
    return {
      requestId: null,
      grantedRoles,
      accessApplied: false,
      rolesAssigned: 0,
      usersProcessed: 0
    };
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');
    await persistApprovedRolesToRequest(
      client,
      resolvedRequestId,
      accessRequest.serviceId,
      grantedRoles
    );

    if (accessRequest.id && Number(accessRequest.requestId) !== Number(resolvedRequestId)) {
      await client.query(
        `
          UPDATE admin_access_requests
          SET request_id = $2
          WHERE id = $1
        `,
        [accessRequest.id, resolvedRequestId]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const hasUsers = await requestHasProvisionedUsers(resolvedRequestId);
  const hasResourceGroup = await requestHasResourceGroup(resolvedRequestId);

  if (!hasUsers || !hasResourceGroup) {
    return {
      requestId: resolvedRequestId,
      grantedRoles,
      accessApplied: false,
      rolesAssigned: 0,
      usersProcessed: 0
    };
  }

  const provisionResult = await roleProvisionService.provisionRolesForRequest(resolvedRequestId);

  return {
    requestId: resolvedRequestId,
    grantedRoles,
    accessApplied: Number(provisionResult.rolesAssigned || 0) > 0,
    rolesAssigned: Number(provisionResult.rolesAssigned || 0),
    usersProcessed: Number(provisionResult.usersProcessed || 0)
  };
};

const createAdminAccessRequest = async ({
  customerEmail,
  serviceId,
  serviceName,
  defaultRole,
  requestedAccess,
  accountCount,
  requestId
}) => {
  const email = String(customerEmail || '').trim().toLowerCase();
  const accessText = String(requestedAccess || '').trim();
  const sid = Number(serviceId);
  const name = String(serviceName || '').trim();

  if (!email) {
    throw new AppError('customerEmail is required.', 400);
  }

  if (!Number.isInteger(sid) || sid <= 0) {
    throw new AppError('serviceId must be a positive integer.', 400);
  }

  if (!name) {
    throw new AppError('serviceName is required.', 400);
  }

  if (!accessText) {
    throw new AppError('Describe the admin access you need.', 400);
  }

  const serviceResult = await db.query(
    `
      SELECT id, name, default_role
      FROM services
      WHERE id = $1
      LIMIT 1
    `,
    [sid]
  );

  if (!serviceResult.rows.length) {
    throw new AppError('Service not found.', 404);
  }

  const service = serviceResult.rows[0];
  const resolvedDefaultRole = defaultRole || service.default_role || null;
  const parsedRequestId = requestId ? Number(requestId) : null;

  const result = await db.query(
    `
      INSERT INTO admin_access_requests (
        request_id,
        customer_email,
        service_id,
        service_name,
        default_role,
        requested_access,
        account_count,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      RETURNING *
    `,
    [
      Number.isInteger(parsedRequestId) && parsedRequestId > 0 ? parsedRequestId : null,
      email,
      sid,
      name,
      resolvedDefaultRole,
      accessText,
      Number.isInteger(accountCount) && accountCount > 0 ? accountCount : null
    ]
  );

  return mapRow(result.rows[0]);
};

const linkAdminAccessRequestsToRequest = async ({ customerEmail, requestId, client = db }) => {
  const email = String(customerEmail || '').trim().toLowerCase();
  const rid = Number(requestId);

  if (!email || !Number.isInteger(rid) || rid <= 0) {
    return { linkedCount: 0 };
  }

  const result = await client.query(
    `
      UPDATE admin_access_requests
      SET request_id = $2
      WHERE customer_email = $1
        AND request_id IS NULL
      RETURNING id
    `,
    [email, rid]
  );

  return { linkedCount: result.rows.length };
};

const fulfillLinkedApprovedAccessRequests = async ({ customerEmail, requestId }) => {
  const email = String(customerEmail || '').trim().toLowerCase();
  const rid = Number(requestId);

  if (!email || !Number.isInteger(rid) || rid <= 0) {
    return { fulfilledCount: 0 };
  }

  const result = await db.query(
    `
      SELECT *
      FROM admin_access_requests
      WHERE customer_email = $1
        AND request_id = $2
        AND status = 'approved'
    `,
    [email, rid]
  );

  let fulfilledCount = 0;

  for (const row of result.rows) {
    const accessRequest = mapRow(row);
    const fulfillment = await applyApprovedRolesForRequest(accessRequest);

    if (fulfillment.accessApplied) {
      fulfilledCount += 1;

      try {
        await sendAdminAccessDecisionEmail({
          customerEmail: accessRequest.customerEmail,
          serviceName: accessRequest.serviceName,
          requestedAccess: accessRequest.requestedAccess,
          status: 'approved',
          grantedRoles: fulfillment.grantedRoles,
          accessApplied: true,
          reviewNotes: accessRequest.reviewNotes
        });
      } catch (emailError) {
        logAdminAccessEvent('error', 'approved_access_email_failed', {
          accessRequestId: accessRequest.id,
          requestId: rid,
          message: emailError?.message
        });
      }
    }
  }

  return { fulfilledCount };
};

const listAdminAccessRequests = async ({ status, requestId } = {}) => {
  const conditions = [];
  const params = [];

  if (status) {
    params.push(String(status).trim().toLowerCase());
    conditions.push(`aar.status = $${params.length}`);
  }

  if (requestId) {
    params.push(Number(requestId));
    conditions.push(`aar.request_id = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.query(
    `
      SELECT
        aar.*,
        r.azure_resource_group_name,
        r.location AS request_location,
        r.status AS request_status
      FROM admin_access_requests aar
      LEFT JOIN requests r ON r.id = aar.request_id
      ${whereClause}
      ORDER BY aar.created_at DESC
    `,
    params
  );

  return result.rows.map((row) => ({
    ...mapRow(row),
    resourceGroup: row.azure_resource_group_name,
    requestLocation: row.request_location,
    requestStatus: row.request_status
  }));
};

const updateAdminAccessRequestStatus = async ({
  id,
  status,
  reviewedBy,
  reviewNotes
}) => {
  const accessRequestId = Number(id);
  const nextStatus = String(status || '').trim().toLowerCase();

  if (!Number.isInteger(accessRequestId) || accessRequestId <= 0) {
    throw new AppError('Request id must be a positive integer.', 400);
  }

  if (!['approved', 'rejected'].includes(nextStatus)) {
    throw new AppError('status must be approved or rejected.', 400);
  }

  const result = await db.query(
    `
      UPDATE admin_access_requests
      SET
        status = $2,
        reviewed_by = $3,
        reviewed_at = NOW(),
        review_notes = $4
      WHERE id = $1
        AND status = 'pending'
      RETURNING *
    `,
    [accessRequestId, nextStatus, reviewedBy || null, reviewNotes || null]
  );

  if (!result.rows.length) {
    throw new AppError('Admin access request not found or already reviewed.', 404);
  }

  return mapRow(result.rows[0]);
};

const reviewAdminAccessRequest = async ({ id, status, reviewedBy, reviewNotes }) => {
  const updatedRequest = await updateAdminAccessRequestStatus({
    id,
    status,
    reviewedBy,
    reviewNotes
  });

  let fulfillment = {
    requestId: updatedRequest.requestId,
    grantedRoles: [],
    accessApplied: false,
    rolesAssigned: 0,
    usersProcessed: 0
  };

  if (updatedRequest.status === 'approved') {
    fulfillment = await applyApprovedRolesForRequest(updatedRequest);
    updatedRequest.requestId = fulfillment.requestId || updatedRequest.requestId;
  }

  let emailSent = false;

  try {
    await sendAdminAccessDecisionEmail({
      customerEmail: updatedRequest.customerEmail,
      serviceName: updatedRequest.serviceName,
      requestedAccess: updatedRequest.requestedAccess,
      status: updatedRequest.status,
      grantedRoles: fulfillment.grantedRoles,
      accessApplied: fulfillment.accessApplied,
      reviewNotes: updatedRequest.reviewNotes
    });
    emailSent = true;
  } catch (emailError) {
    logAdminAccessEvent('error', 'decision_email_failed', {
      accessRequestId: updatedRequest.id,
      status: updatedRequest.status,
      message: emailError?.message
    });
  }

  return {
    ...updatedRequest,
    ...fulfillment,
    emailSent
  };
};

module.exports = {
  applyApprovedRolesForRequest,
  createAdminAccessRequest,
  fulfillLinkedApprovedAccessRequests,
  linkAdminAccessRequestsToRequest,
  listAdminAccessRequests,
  reviewAdminAccessRequest,
  resolveRolesForAccessRequest,
  updateAdminAccessRequestStatus
};
