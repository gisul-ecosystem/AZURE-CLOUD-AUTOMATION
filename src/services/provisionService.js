const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const { provisionResourceGroup } = require('../provisioners/azure/resourceGroupProvisioner');
const { assertProvisionableLocation } = require('./azureLocationService');

const STATUS_COMPLETED = 'Completed';

const logProvisionEvent = (level, event, details = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'request-provisioning',
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

const getRequestForProvisioning = async (client, requestId) => {
  const query = `
    SELECT
      id,
      status,
      location,
      azure_resource_group_id,
      azure_resource_group_name
    FROM requests
    WHERE id = $1
    FOR UPDATE
  `;

  const result = await client.query(query, [requestId]);
  return result.rows[0] || null;
};

const updateProvisionedRequest = async (client, requestId, resourceGroupId, resourceGroupName) => {
  const query = `
    UPDATE requests
    SET
      azure_resource_group_id = $1,
      azure_resource_group_name = $2,
      status = $3
    WHERE id = $4
    RETURNING id, status, azure_resource_group_id, azure_resource_group_name
  `;

  const result = await client.query(query, [
    resourceGroupId,
    resourceGroupName,
    STATUS_COMPLETED,
    requestId
  ]);

  return result.rows[0];
};

const getProvisionedRequest = async (requestId) => {
  const query = `
    SELECT
      id,
      status,
      azure_resource_group_id,
      azure_resource_group_name
    FROM requests
    WHERE id = $1
  `;

  const result = await db.query(query, [requestId]);

  if (result.rows.length === 0) {
    return null;
  }

  const request = result.rows[0];

  return {
    id: request.id,
    status: request.status,
    resourceGroup: request.azure_resource_group_name || null,
    resourceGroupId: request.azure_resource_group_id || null
  };
};

const provisionRequestResourceGroup = async (requestId) => {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const request = await getRequestForProvisioning(client, requestId);

    if (!request) {
      throw new AppError('Request not found.', 404);
    }

    if (request.azure_resource_group_name) {
      await client.query('COMMIT');

      logProvisionEvent('info', 'provision_request_reused_existing', {
        requestId,
        status: request.status,
        resourceGroup: request.azure_resource_group_name
      });

      return {
        resourceGroup: request.azure_resource_group_name
      };
    }

    if (typeof request.location !== 'string' || request.location.trim().length === 0) {
      throw new AppError('Request location is missing.', 400);
    }

    const resourceGroupName = `RG-CUST-${requestId}`;
    const location = request.location.trim();
    assertProvisionableLocation(location);

    logProvisionEvent('info', 'provision_request_started', {
      requestId,
      status: request.status,
      resourceGroupName,
      location
    });

    const provisionedResourceGroup = await provisionResourceGroup({
      requestId,
      resourceGroupName,
      location
    });

    await updateProvisionedRequest(
      client,
      requestId,
      provisionedResourceGroup.resourceGroupId,
      provisionedResourceGroup.resourceGroupName
    );

    await client.query('COMMIT');

    logProvisionEvent('info', 'provision_request_completed', {
      requestId,
      resourceGroupName: provisionedResourceGroup.resourceGroupName,
      resourceGroupId: provisionedResourceGroup.resourceGroupId
    });

    return {
      resourceGroup: provisionedResourceGroup.resourceGroupName
    };
  } catch (error) {
    await client.query('ROLLBACK');

    logProvisionEvent('error', 'provision_request_failed', {
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
  getProvisionedRequest,
  provisionRequestResourceGroup
};
