const { validateAzureEnv } = require('../../config/azure');
const { configureInstancePolicy } = require('./instancePolicyProvisioner');
const AppError = require('../../utils/AppError');

const normalizeServiceName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^azure\s+/, '')
    .replace(/\(.*?\)/g, '')
    .trim();

const logEvent = (event, details = {}) => {
  console.log(
    JSON.stringify({
      event,
      service: 'azure-service-resource-provisioner',
      timestamp: new Date().toISOString(),
      ...details
    })
  );
};

const provisionServiceResource = async ({
  requestId,
  serviceId,
  serviceName,
  resourceGroupName,
  instanceOption
}) => {
  logEvent('service_instance_policy_started', {
    requestId,
    serviceId,
    serviceName,
    instanceOption,
    resourceGroupName
  });

  try {
    const result = await configureInstancePolicy({
      requestId,
      serviceId,
      serviceName,
      resourceGroupName,
      instanceOption
    });

    logEvent('service_instance_policy_success', {
      requestId,
      serviceId,
      serviceName,
      scope: result.azureResourceId
    });

    return result;
  } catch (error) {
    logEvent('service_instance_policy_failed', {
      requestId,
      serviceId,
      serviceName,
      message: error?.message
    });

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      `Failed to configure instance policy for ${serviceName}: ${error?.message || 'Unknown error'}`,
      502
    );
  }
};

module.exports = {
  provisionServiceResource,
  normalizeServiceName
};
