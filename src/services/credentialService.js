const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const {
  buildCredentialEmailHtml,
  sendCredentialEmailWithRetry
} = require('./email/credentialEmailService');

const DELIVERY_STATUS_PENDING = 'Pending';
const DELIVERY_STATUS_SENT = 'Sent';
const DELIVERY_STATUS_FAILED = 'Failed';

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
      status
    FROM requests
    WHERE id = $1
    FOR UPDATE
  `;

  const result = await client.query(query, [requestId]);
  return result.rows[0] || null;
};

const getAzureUsersByRequestId = async (client, requestId) => {
  const query = `
    SELECT
      id,
      request_id,
      azure_user_id,
      username,
      temporary_password,
      status
    FROM azure_users
    WHERE request_id = $1
    ORDER BY id ASC
  `;

  const result = await client.query(query, [requestId]);
  return result.rows;
};

const getDeliveryByRequestId = async (client, requestId) => {
  const query = `
    SELECT
      request_id,
      recipient_email,
      delivery_status,
      sent_at
    FROM credential_delivery
    WHERE request_id = $1
    ORDER BY sent_at DESC NULLS LAST
    LIMIT 1
  `;

  const result = await client.query(query, [requestId]);
  return result.rows[0] || null;
};

const upsertDeliveryRecord = async (client, requestId, recipientEmail, deliveryStatus) => {
  const sentAt = deliveryStatus === DELIVERY_STATUS_SENT ? new Date() : null;

  const updateQuery = `
    UPDATE credential_delivery
    SET
      recipient_email = $2,
      delivery_status = $3,
      sent_at = $4
    WHERE request_id = $1
    RETURNING request_id, recipient_email, delivery_status, sent_at
  `;

  const updateResult = await client.query(updateQuery, [
    requestId,
    recipientEmail,
    deliveryStatus,
    sentAt
  ]);

  if (updateResult.rows.length > 0) {
    return updateResult.rows[0];
  }

  const insertQuery = `
    INSERT INTO credential_delivery (
      request_id,
      recipient_email,
      delivery_status,
      sent_at
    )
    VALUES ($1, $2, $3, $4)
    RETURNING request_id, recipient_email, delivery_status, sent_at
  `;

  const insertResult = await client.query(insertQuery, [
    requestId,
    recipientEmail,
    deliveryStatus,
    sentAt
  ]);

  return insertResult.rows[0];
};

const buildCredentialPackage = ({ request, azureUsers }) => {
  return {
    requestId: request.id,
    recipientEmail: request.customer_email,
    users: azureUsers.map((user) => ({
      username: user.username,
      temporaryPassword: user.temporary_password
    }))
  };
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

const sendCredentialsForRequest = async (requestId) => {
  validateRequestId(requestId);

  const client = await db.connect();
  let recipientEmail = null;

  try {
    await client.query('BEGIN');

    const request = await getRequestById(client, requestId);

    if (!request) {
      throw new AppError('Request not found.', 404);
    }

    const azureUsers = await getAzureUsersByRequestId(client, requestId);

    if (azureUsers.length === 0) {
      throw new AppError('No Azure users are available for this request.', 400);
    }

    const existingDelivery = await getDeliveryByRequestId(client, requestId);

    if (existingDelivery?.delivery_status === DELIVERY_STATUS_SENT) {
      await client.query('COMMIT');

      logCredentialEvent('info', 'credential_delivery_reused_existing', {
        requestId,
        recipientEmail: existingDelivery.recipient_email
      });

      return {
        emailSent: true
      };
    }

    const credentialPackage = buildCredentialPackage({ request, azureUsers });
    recipientEmail = credentialPackage.recipientEmail;

    await upsertDeliveryRecord(
      client,
      requestId,
      recipientEmail,
      DELIVERY_STATUS_PENDING
    );

    await client.query('COMMIT');

    const html = buildCredentialEmailHtml({
      requestId,
      users: credentialPackage.users
    });

    logCredentialEvent('info', 'credential_delivery_email_started', {
      requestId,
      recipientEmail,
      userCount: credentialPackage.users.length
    });

    await sendCredentialEmailWithRetry({
      to: recipientEmail,
      subject: `Azure Access Credentials for Request #${requestId}`,
      html
    });

    const finalizeClient = await db.connect();

    try {
      await finalizeClient.query('BEGIN');
      await upsertDeliveryRecord(
        finalizeClient,
        requestId,
        recipientEmail,
        DELIVERY_STATUS_SENT
      );
      await finalizeClient.query('COMMIT');
    } catch (error) {
      await finalizeClient.query('ROLLBACK');
      throw error;
    } finally {
      finalizeClient.release();
    }

    logCredentialEvent('info', 'credential_delivery_email_success', {
      requestId,
      recipientEmail
    });

    return {
      emailSent: true
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logCredentialEvent('error', 'credential_delivery_rollback_failed', {
        requestId,
        errorName: rollbackError?.name,
        errorCode: rollbackError?.code,
        message: rollbackError?.message
      });
    }

    if (requestId && recipientEmail) {
      try {
        const failureClient = await db.connect();
        try {
          await failureClient.query('BEGIN');
          await upsertDeliveryRecord(failureClient, requestId, recipientEmail, DELIVERY_STATUS_FAILED);
          await failureClient.query('COMMIT');
        } catch (failureError) {
          await failureClient.query('ROLLBACK');
          throw failureError;
        } finally {
          failureClient.release();
        }
      } catch (deliveryError) {
        logCredentialEvent('error', 'credential_delivery_save_failed', {
          requestId,
          errorName: deliveryError?.name,
          errorCode: deliveryError?.code,
          message: deliveryError?.message
        });
      }
    }

    logCredentialEvent('error', 'credential_delivery_failed', {
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

module.exports = {
  getCredentialDelivery,
  sendCredentialsForRequest
};
