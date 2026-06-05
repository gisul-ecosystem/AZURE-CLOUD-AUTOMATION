const crypto = require('crypto');
const { AuthorizationManagementClient } = require('@azure/arm-authorization');
const { createAzureCredential, validateAzureEnv } = require('../../config/azure');
const AppError = require('../../utils/AppError');

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const logAzureRoleEvent = (level, event, details = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'azure-role-provisioner',
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

const normalizeRoleName = (value) => String(value || '').trim().toLowerCase();

const createAuthorizationClient = () => {
  const azureConfig = validateAzureEnv();
  const credential = createAzureCredential(azureConfig);

  return {
    authorizationClient: new AuthorizationManagementClient(credential, azureConfig.subscriptionId),
    subscriptionId: azureConfig.subscriptionId
  };
};

const buildResourceGroupScope = (subscriptionId, resourceGroupName) => {
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`;
};

const roleAssignmentIdFromSeed = (seed) => {
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  const chars = hash.slice(0, 32).split('');

  chars[12] = '4';
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);

  return [
    chars.slice(0, 8).join(''),
    chars.slice(8, 12).join(''),
    chars.slice(12, 16).join(''),
    chars.slice(16, 20).join(''),
    chars.slice(20, 32).join('')
  ].join('-');
};

const findMatchingRoleDefinition = async (authorizationClient, scope, roleName) => {
  const targetRoleName = normalizeRoleName(roleName);

  for await (const roleDefinition of authorizationClient.roleDefinitions.list(scope)) {
    if (normalizeRoleName(roleDefinition.roleName) === targetRoleName) {
      return roleDefinition;
    }
  }

  return null;
};

const createRoleAssignmentWithRetry = async (
  authorizationClient,
  scope,
  assignmentId,
  parameters,
  requestId
) => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await authorizationClient.roleAssignments.create(scope, assignmentId, parameters);
    } catch (error) {
      lastError = error;

      if (attempt === MAX_ATTEMPTS || !isRetryableError(error)) {
        throw error;
      }

      const delayMs = 500 * 2 ** (attempt - 1);

      logAzureRoleEvent('info', 'azure_role_assign_retry', {
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

const getExistingAzureAssignment = async (authorizationClient, scope, assignmentId) => {
  try {
    return await authorizationClient.roleAssignments.get(scope, assignmentId);
  } catch (error) {
    const statusCode = Number(error?.statusCode || error?.status);

    if (statusCode === 404) {
      return null;
    }

    throw error;
  }
};

module.exports = {
  buildResourceGroupScope,
  createAuthorizationClient,
  createRoleAssignmentWithRetry,
  findMatchingRoleDefinition,
  getExistingAzureAssignment,
  logAzureRoleEvent,
  roleAssignmentIdFromSeed
};
