require('isomorphic-fetch');

const crypto = require('crypto');
const { Client } = require('@microsoft/microsoft-graph-client');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');
const { createAzureCredential, validateAzureEnv } = require('../../config/azure');
const AppError = require('../../utils/AppError');

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;
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

const getRetryDelayMs = (error, attempt) => {
  const retryAfterHeader =
    error?.response?.headers?.get?.('retry-after') ||
    error?.headers?.['retry-after'] ||
    error?.responseHeaders?.['retry-after'];

  const retryAfterSeconds = Number(retryAfterHeader);

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 30000);
  }

  return Math.min(500 * 2 ** (attempt - 1), 30000);
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

const getRowField = (row, ...keys) => {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return '';
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

const buildBulkUserPayload = ({ row, index, domain, jobId }) => {
  const displayName = getRowField(row, 'displayName', 'displayname', 'name') || `Bulk User ${jobId}-${index + 1}`;
  const normalizedEmail = getRowField(row, 'userPrincipalName', 'user_principal_name', 'email');
  const localPart = normalizedEmail.includes('@')
    ? normalizedEmail.split('@')[0]
    : getRowField(row, 'mailNickname', 'mail_nickname')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.+|\.+$/g, '') || displayName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || `bulk-${jobId}-${index + 1}`;
  const userPrincipalName = `${localPart}@${domain}`;
  const mailNickname = (getRowField(row, 'mailNickname', 'mail_nickname') || localPart || `bulk-${jobId}-${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    || `bulk-${jobId}-${index + 1}`;
  const temporaryPassword = getRowField(row, 'temporaryPassword', 'temporary_password') || generateTemporaryPassword();

  const payload = {
    accountEnabled: true,
    displayName,
    mailNickname,
    userPrincipalName,
    passwordProfile: {
      forceChangePasswordNextSignIn: true,
      password: temporaryPassword
    },
    passwordPolicies: 'DisablePasswordExpiration'
  };

  if (getRowField(row, 'givenName', 'given_name')) {
    payload.givenName = getRowField(row, 'givenName', 'given_name');
  }

  if (getRowField(row, 'surname')) {
    payload.surname = getRowField(row, 'surname');
  }

  if (getRowField(row, 'jobTitle', 'job_title')) {
    payload.jobTitle = getRowField(row, 'jobTitle', 'job_title');
  }

  if (getRowField(row, 'department')) {
    payload.department = getRowField(row, 'department');
  }

  if (getRowField(row, 'officeLocation', 'office_location')) {
    payload.officeLocation = getRowField(row, 'officeLocation', 'office_location');
  }

  if (getRowField(row, 'usageLocation', 'usage_location')) {
    payload.usageLocation = getRowField(row, 'usageLocation', 'usage_location');
  }

  const explicitEmailPreference = String(
    row.sendWelcomeEmail ?? row.sendwelcomeemail ?? row.send_welcome_email ?? row.send_welcomeemail ?? ''
  )
    .trim()
    .toLowerCase();
  const shouldNotify =
    explicitEmailPreference === ''
      ? Boolean(getRowField(row, 'notifyEmail', 'notify_email', 'email'))
      : ['true', '1', 'yes', 'y', 'on'].includes(explicitEmailPreference);

  return {
    username: mailNickname,
    temporaryPassword,
    payload,
    updateFields: ['jobTitle', 'department', 'officeLocation', 'usageLocation'].filter((field) => {
      const aliasMap = {
        jobTitle: ['jobTitle', 'job_title'],
        department: ['department'],
        officeLocation: ['officeLocation', 'office_location'],
        usageLocation: ['usageLocation', 'usage_location']
      };

      return Boolean(getRowField(row, ...(aliasMap[field] || [field])));
    }),
    groupIds: getRowField(row, 'groupIds', 'group_ids', 'groups')
      .split(/[;,]/)
      .map((value) => String(value || '').trim())
      .filter(Boolean),
    notifyEmail: shouldNotify ? (getRowField(row, 'notifyEmail', 'notify_email', 'email') || null) : null
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

      const delayMs = getRetryDelayMs(error, attempt);

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
  buildBulkUserPayload,
  createGraphClient,
  createGraphUserWithRetry,
  getVerifiedDomain,
  logAzureUserEvent,
  getRetryDelayMs
};
