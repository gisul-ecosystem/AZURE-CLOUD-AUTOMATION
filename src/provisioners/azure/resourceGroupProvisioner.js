const { ResourceManagementClient } = require('@azure/arm-resources');
const { createAzureCredential, validateAzureEnv } = require('../../config/azure');
const AppError = require('../../utils/AppError');

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const logAzureProvisionEvent = (level, event, details = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'azure-resource-group-provisioner',
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

const isRetryableError = (error) => {
  const statusCode = Number(error?.statusCode || error?.status);
  const errorCode = String(error?.code || '').toUpperCase();

  return (
    RETRYABLE_STATUS_CODES.has(statusCode) ||
    ['ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'REQUESTTIMEOUT'].includes(errorCode)
  );
};

const createResourceGroupWithRetry = async (resourceGroupsClient, resourceGroupName, location) => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await resourceGroupsClient.createOrUpdate(resourceGroupName, {
        location
      });
    } catch (error) {
      lastError = error;

      if (attempt === MAX_ATTEMPTS || !isRetryableError(error)) {
        throw error;
      }

      const delayMs = 500 * 2 ** (attempt - 1);

      logAzureProvisionEvent('info', 'azure_rg_create_retry', {
        resourceGroupName,
        location,
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

const provisionResourceGroup = async ({ requestId, resourceGroupName, location }) => {
  const azureConfig = validateAzureEnv();
  const credential = createAzureCredential(azureConfig);
  const resourceClient = new ResourceManagementClient(credential, azureConfig.subscriptionId);

  logAzureProvisionEvent('info', 'azure_rg_create_started', {
    requestId,
    subscriptionId: azureConfig.subscriptionId,
    resourceGroupName,
    location
  });

  try {
    const response = await createResourceGroupWithRetry(
      resourceClient.resourceGroups,
      resourceGroupName,
      location
    );

    const createdResourceGroupName = response?.name || resourceGroupName;
    const createdResourceGroupId = response?.id || null;

    logAzureProvisionEvent('info', 'azure_rg_create_success', {
      requestId,
      subscriptionId: azureConfig.subscriptionId,
      resourceGroupName: createdResourceGroupName,
      resourceGroupId: createdResourceGroupId,
      location
    });

    return {
      resourceGroupId: createdResourceGroupId,
      resourceGroupName: createdResourceGroupName,
      subscriptionId: azureConfig.subscriptionId
    };
  } catch (error) {
    logAzureProvisionEvent('error', 'azure_rg_create_failed', {
      requestId,
      subscriptionId: azureConfig.subscriptionId,
      resourceGroupName,
      location,
      errorName: error?.name,
      errorCode: error?.code,
      statusCode: error?.statusCode || error?.status,
      message: error?.message
    });

    if (error instanceof AppError) {
      throw error;
    }

    const statusCode = Number(error?.statusCode || error?.status);
    const errorCode = String(error?.code || '');
    const azureMessage = String(error?.message || '').trim();

    if (statusCode === 401 || statusCode === 403) {
      throw new AppError('Azure authentication failed or access was denied.', 403);
    }

    if (errorCode === 'LocationNotAvailableForResourceGroup') {
      throw new AppError(
        azureMessage ||
          `Region '${location}' cannot be used for resource groups. Choose a production Azure region.`,
        400
      );
    }

    if (statusCode === 400 && azureMessage) {
      throw new AppError(azureMessage, 400);
    }

    throw new AppError(azureMessage || 'Unable to create Azure resource group.', 502);
  }
};

module.exports = {
  provisionResourceGroup
};
