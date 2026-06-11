require('isomorphic-fetch');

const crypto = require('crypto');
const { Client } = require('@microsoft/microsoft-graph-client');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');
const { createAzureCredential, validateAzureEnv } = require('../../config/azure');
const AppError = require('../../utils/AppError');

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const GRAPH_SCOPES = ['https://graph.microsoft.com/.default'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const logAzureUserEvent = (level, event, details = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'azure-user-provisioner',
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

const createGraphClient = () => {
  const azureConfig = validateAzureEnv();
  const credential = createAzureCredential(azureConfig);
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: GRAPH_SCOPES
  });

  return {
    graphClient: Client.initWithMiddleware({
      authProvider
    }),
    subscriptionId: azureConfig.subscriptionId
  };
};

const getVerifiedDomain = async (graphClient) => {
  const response = await graphClient.api('/organization').select('verifiedDomains').get();
  const organization = Array.isArray(response?.value) ? response.value[0] : response;
  const verifiedDomains = organization?.verifiedDomains || [];

  const selectedDomain = verifiedDomains.find((domain) => domain.isDefault)
    || verifiedDomains.find((domain) => domain.isInitial)
    || verifiedDomains[0];

  if (!selectedDomain?.name) {
    throw new AppError('Unable to determine a verified Microsoft Graph domain for user creation.', 500);
  }

  return selectedDomain.name;
};

const generateTemporaryPassword = () => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%^&*_-+=';
  const allChars = `${upper}${lower}${digits}${special}`;

  const randomChar = (charset) => charset[crypto.randomInt(0, charset.length)];

  const passwordChars = [
    randomChar(upper),
    randomChar(lower),
    randomChar(digits),
    randomChar(special)
  ];

  while (passwordChars.length < 16) {
    passwordChars.push(randomChar(allChars));
  }

  for (let index = passwordChars.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(0, index + 1);
    [passwordChars[index], passwordChars[swapIndex]] = [passwordChars[swapIndex], passwordChars[index]];
  }

  return passwordChars.join('');
};

const buildUserPayload = ({ requestId, userNumber, domain, accountEnabled = true }) => {
  const username = `cust-${requestId}-user-${userNumber}`;
  const temporaryPassword = generateTemporaryPassword();

  return {
    username,
    temporaryPassword,
    payload: {
      accountEnabled: accountEnabled !== false,
      displayName: `Customer ${requestId} User ${userNumber}`,
      mailNickname: username,
      userPrincipalName: `${username}@${domain}`,
      passwordProfile: {
        forceChangePasswordNextSignIn: true,
        password: temporaryPassword
      },
      passwordPolicies: 'DisablePasswordExpiration'
    }
  };
};

const createGraphUserWithRetry = async (graphClient, userPayload, requestId) => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await graphClient.api('/users').post(userPayload);
    } catch (error) {
      lastError = error;

      if (attempt === MAX_ATTEMPTS || !isRetryableError(error)) {
        throw error;
      }

      const delayMs = 500 * 2 ** (attempt - 1);

      logAzureUserEvent('info', 'azure_user_create_retry', {
        requestId,
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

module.exports = {
  buildUserPayload,
  createGraphClient,
  createGraphUserWithRetry,
  getVerifiedDomain,
  logAzureUserEvent
};
