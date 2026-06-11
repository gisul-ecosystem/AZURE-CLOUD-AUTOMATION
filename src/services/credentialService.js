const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const accessPortalService = require('./accessPortalService');
const { enqueueEmail } = require('./emailQueueService');
const {
  buildCredentialEmailHtml,
} = require('./email/credentialEmailService');

const DELIVERY_STATUS_QUEUED = 'queued';
const DELIVERY_STATUS_SENT = 'sent';

const logCredentialEvent = (level, event, details = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'credential-delivery',
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

const validateRequestId = (requestId) => {
  if (requestId === undefined || requestId === null || String(requestId).trim() === '') {
    throw new AppError('request_id is required.', 400);
  }
};

const getRequestById = async (client, requestId) => {
  const query = `
    SELECT
      id,
      customer_email,
      account_count,
      status,
      expiry_date
    FROM requests
    WHERE id = $1
  `;

  const result = await client.query(query, [requestId]);
  return result.rows[0] || null;
};

const getProvisionedUsersByRequestId = async (client, requestId) => {
  const query = `
    SELECT
      azure_user_id,
      username,
      temporary_password,
      status
    FROM azure_users
    WHERE request_id = $1
      AND COALESCE(is_deleted, FALSE) = FALSE
    ORDER BY username ASC
  `;

  const result = await client.query(query, [requestId]);
  return result.rows;
};

const loadCredentials = async (requestId) => {
  const [request, users] = await Promise.all([
    getRequestById(db, requestId),
    getProvisionedUsersByRequestId(db, requestId)
  ]);

  return {
    request,
    users
  };
};

const upsertDeliveryRecord = async (client, requestId, recipientEmail, deliveryStatus) => {
  const createdAt = new Date();
  const sentAt = deliveryStatus === DELIVERY_STATUS_SENT ? createdAt : null;

  const updateQuery = `
    UPDATE credential_delivery
    SET
      recipient_email = $2,
      delivery_status = $3,
      sent_at = $4,
      created_at = $5
    WHERE request_id = $1
    RETURNING request_id, recipient_email, delivery_status, sent_at
  `;

  const updateResult = await client.query(updateQuery, [
    requestId,
    recipientEmail,
    deliveryStatus,
    sentAt,
    createdAt
  ]);

  if (updateResult.rows.length > 0) {
    return updateResult.rows[0];
  }

  const insertQuery = `
    INSERT INTO credential_delivery (
      request_id,
      recipient_email,
      delivery_status,
      sent_at,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING request_id, recipient_email, delivery_status, sent_at
  `;

  const insertResult = await client.query(insertQuery, [
    requestId,
    recipientEmail,
    deliveryStatus,
    sentAt,
    createdAt
  ]);

  return insertResult.rows[0];
};

const getCredentialDelivery = async (requestId) => {
  validateRequestId(requestId);

  const query = `
    SELECT
      request_id,
      recipient_email,
      delivery_status,
      sent_at
    FROM credential_delivery
    WHERE request_id = $1
  `;

  const result = await db.query(query, [requestId]);

  if (result.rows.length === 0) {
    return null;
  }

  return {
    requestId: result.rows[0].request_id,
    recipientEmail: result.rows[0].recipient_email,
    deliveryStatus: result.rows[0].delivery_status,
    sentAt: result.rows[0].sent_at
  };
};

const sendCredentials = async (requestId) => {
  validateRequestId(requestId);

  const portalPromise = accessPortalService.issueAccessPortalTokenForRequest(requestId);
  const credentialPromise = loadCredentials(requestId);

  const [portal, credentials] = await Promise.all([
    portalPromise,
    credentialPromise
  ]);

  if (!credentials.request) {
    throw new AppError('Request not found.', 404);
  }

  if (!credentials.users.length) {
    throw new AppError('No provisioned users found', 400);
  }

  const request = credentials.request;
  const users = credentials.users;
  const portalLink = portal.manageUrl;
  const adminCredentials = portal.adminCredentials;

  const html = buildCredentialEmailHtml({
    requestId,
    users,
    adminCredentials,
    portalLink,
    expiresAt: portal.expiresAt.toISOString()
  });

  logCredentialEvent('info', 'credential_delivery_email_started', {
    requestId,
    recipientEmail: request.customer_email,
    manageUrl: portalLink
  });

  try {
    await upsertDeliveryRecord(
      db,
      requestId,
      request.customer_email,
      DELIVERY_STATUS_QUEUED
    );

    await enqueueEmail({
      recipientEmail: request.customer_email,
      subject: `Azure Credentials Ready — Request #${requestId}`,
      html,
      relatedType: 'credential_delivery',
      relatedId: String(requestId),
      onSuccess: async () => {
        await upsertDeliveryRecord(
          db,
          requestId,
          request.customer_email,
          DELIVERY_STATUS_SENT
        );

        logCredentialEvent('info', 'credential_delivery_email_success', {
          requestId,
          recipientEmail: request.customer_email
        });
      },
      onFailure: async (error) => {
        await upsertDeliveryRecord(
          db,
          requestId,
          request.customer_email,
          'failed'
        );

        logCredentialEvent('error', 'credential_delivery_email_failed', {
          requestId,
          recipientEmail: request.customer_email,
          message: error?.message
        });
      }
    });

    logCredentialEvent('info', 'credential_delivery_email_queued', {
      requestId,
      recipientEmail: request.customer_email
    });

    return {
      success: true,
      requestId,
      portalLink,
      adminUsername: adminCredentials?.username || null,
      usersSent: users.length,
      deliveryStatus: DELIVERY_STATUS_QUEUED
    };
  } catch (error) {
    logCredentialEvent('error', 'credential_delivery_failed', {
      requestId,
      errorName: error?.name,
      errorCode: error?.code,
      statusCode: error?.statusCode || error?.status,
      message: error?.message
    });

    throw error;
  }
};

module.exports = {
  getCredentialDelivery,
  sendCredentials,
  sendCredentialsForRequest: sendCredentials
};
