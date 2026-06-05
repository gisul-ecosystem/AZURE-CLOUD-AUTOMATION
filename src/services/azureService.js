const { ResourceManagementClient } = require('@azure/arm-resources');
const { createAzureCredential, validateAzureEnv } = require('../config/azure');
const AppError = require('../utils/AppError');

const logAzureEvent = (level, event, details = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'azure-auth',
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

const getAzureErrorStatus = (error) => {
  const statusCode = error?.statusCode || error?.status || error?.code;

  if (statusCode === 401 || statusCode === 403 || statusCode === '401' || statusCode === '403') {
    return 403;
  }

  return 500;
};

const testAzureConnection = async () => {
  try {
    const azureConfig = validateAzureEnv();

    logAzureEvent('info', 'azure_auth_test_started', {
      subscriptionId: azureConfig.subscriptionId
    });

    const credential = createAzureCredential(azureConfig);
    const resourceClient = new ResourceManagementClient(credential, azureConfig.subscriptionId);

    let resourceGroupCount = 0;

    for await (const _resourceGroup of resourceClient.resourceGroups.list()) {
      resourceGroupCount += 1;
    }

    logAzureEvent('info', 'azure_auth_test_success', {
      subscriptionId: azureConfig.subscriptionId,
      resourceGroupCount
    });

    return {
      authenticated: true,
      subscriptionId: azureConfig.subscriptionId,
      resourceGroupCount
    };
  } catch (error) {
    const statusCode = getAzureErrorStatus(error);
    const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID?.trim();

    logAzureEvent('error', 'azure_auth_test_failed', {
      subscriptionId,
      statusCode,
      errorName: error?.name,
      errorCode: error?.code,
      message: error?.message
    });

    if (error instanceof AppError) {
      throw error;
    }

    if (statusCode === 403) {
      throw new AppError('Azure authentication failed or access was denied.', 403);
    }

    throw new AppError('Unable to verify Azure authentication.', 500);
  }
};

module.exports = {
  testAzureConnection
};
