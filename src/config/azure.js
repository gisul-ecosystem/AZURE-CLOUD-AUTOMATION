const { ClientSecretCredential } = require('@azure/identity');
const AppError = require('../utils/AppError');

const REQUIRED_ENV_VARS = [
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_TENANT_ID',
  'AZURE_SUBSCRIPTION_ID'
];

const getTrimmedEnvValue = (name) => {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
};

const validateAzureEnv = () => {
  const envValues = REQUIRED_ENV_VARS.reduce((accumulator, name) => {
    accumulator[name] = getTrimmedEnvValue(name);
    return accumulator;
  }, {});

  const missingVars = REQUIRED_ENV_VARS.filter((name) => !envValues[name]);

  if (missingVars.length > 0) {
    throw new AppError(
      `Missing required Azure environment variable(s): ${missingVars.join(', ')}`,
      500
    );
  }

  return {
    clientId: envValues.AZURE_CLIENT_ID,
    clientSecret: envValues.AZURE_CLIENT_SECRET,
    tenantId: envValues.AZURE_TENANT_ID,
    subscriptionId: envValues.AZURE_SUBSCRIPTION_ID
  };
};

const createAzureCredential = ({ tenantId, clientId, clientSecret }) => {
  return new ClientSecretCredential(tenantId, clientId, clientSecret);
};

module.exports = {
  createAzureCredential,
  validateAzureEnv
};
