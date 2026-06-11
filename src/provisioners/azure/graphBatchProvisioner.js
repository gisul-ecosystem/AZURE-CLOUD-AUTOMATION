const AppError = require('../../utils/AppError');

const GRAPH_BATCH_SIZE = 20;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chunkArray = (items, size = GRAPH_BATCH_SIZE) => {
  const chunks = [];
  const array = Array.isArray(items) ? items : [];

  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }

  return chunks;
};

const isRetryableError = (error) => {
  const statusCode = Number(error?.statusCode || error?.status || error?.response?.status);
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

const sendBatch = async (graphClient, requests) => {
  if (!requests.length) {
    return { responses: [] };
  }

  return graphClient.api('/$batch').post({ requests });
};

const executeBatchWithRetry = async (graphClient, requests, context) => {
  let pendingRequests = requests;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && pendingRequests.length > 0; attempt += 1) {
    try {
      const batchResponse = await sendBatch(graphClient, pendingRequests);
      const responses = Array.isArray(batchResponse?.responses) ? batchResponse.responses : [];
      const failedRequests = [];

      const responseMap = new Map(responses.map((response) => [String(response.id), response]));
      const results = [];

      for (const request of pendingRequests) {
        const response = responseMap.get(String(request.id));

        if (!response) {
          failedRequests.push(request);
          continue;
        }

        if (response.status >= 200 && response.status < 300) {
          results.push({
            request,
            response
          });
          continue;
        }

        if (isRetryableError(response)) {
          failedRequests.push(request);
          continue;
        }

        const error = new AppError(
          `Graph batch operation failed for ${context || 'request'} ${request.id} with status ${response.status}.`,
          response.status >= 400 ? response.status : 500
        );
        error.graphResponse = response;
        throw error;
      }

      if (failedRequests.length === 0) {
        return {
          responses,
          failedRequests: [],
          results
        };
      }

      pendingRequests = failedRequests;
      const retryDelayMs = getRetryDelayMs(null, attempt);
      await sleep(retryDelayMs);
    } catch (error) {
      lastError = error;

      if (attempt === MAX_ATTEMPTS || !isRetryableError(error)) {
        throw error;
      }

      const retryDelayMs = getRetryDelayMs(error, attempt);
      await sleep(retryDelayMs);
    }
  }

  throw lastError || new AppError(`Graph batch operation failed for ${context || 'request'}.`, 502);
};

const createUserUpdateBatchRequests = (users, patchFields = []) =>
  users.map((user, index) => {
    const body = {};

    for (const field of patchFields) {
      if (user[field] !== undefined && user[field] !== null && String(user[field]).trim() !== '') {
        body[field] = user[field];
      }
    }

    return {
      id: String(index + 1),
      method: 'PATCH',
      url: `/users/${user.azureUserId}`,
      headers: {
        'Content-Type': 'application/json'
      },
      body
    };
  });

const createGroupMembershipBatchRequests = (groupId, users) =>
  users.map((user, index) => ({
    id: String(index + 1),
    method: 'POST',
    url: `/groups/${groupId}/members/$ref`,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${user.azureUserId}`
    }
  }));

const batchAddUsersToGroups = async (graphClient, groupId, users, context = 'group membership') => {
  const chunks = chunkArray(users, GRAPH_BATCH_SIZE);
  const allResponses = [];

  for (const chunk of chunks) {
    const batchRequests = createGroupMembershipBatchRequests(groupId, chunk);
    const batchResult = await executeBatchWithRetry(graphClient, batchRequests, context);
    allResponses.push(...(batchResult?.responses || []));
  }

  return allResponses;
};

const batchPatchUsers = async (graphClient, users, patchFields, context = 'user updates') => {
  const chunks = chunkArray(users, GRAPH_BATCH_SIZE);
  const allResponses = [];

  for (const chunk of chunks) {
    const batchRequests = createUserUpdateBatchRequests(chunk, patchFields);
    const batchResult = await executeBatchWithRetry(graphClient, batchRequests, context);
    allResponses.push(...(batchResult?.responses || []));
  }

  return allResponses;
};

module.exports = {
  GRAPH_BATCH_SIZE,
  batchAddUsersToGroups,
  batchPatchUsers,
  chunkArray,
  executeBatchWithRetry,
  isRetryableError
};
