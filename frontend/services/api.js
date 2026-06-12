const DEFAULT_BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

const isServer = typeof window === 'undefined';

const buildUrl = (path) => {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (!path.startsWith('/')) {
    return `/${path}`;
  }

  if (isServer) {
    return new URL(path, DEFAULT_BACKEND_URL).toString();
  }

  return path;
};

const readPayload = async (response) => {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
};

const extractMessage = (payload, status) => {
  if (payload && typeof payload === 'object') {
    return payload.message || payload.error || `Request failed with status ${status}`;
  }

  if (typeof payload === 'string' && payload.trim()) {
    return payload;
  }

  return `Request failed with status ${status}`;
};

export async function requestJson(path, options = {}) {
  const response = await fetch(buildUrl(path), {
    cache: 'no-store',
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    body:
      options.body === undefined || options.body === null
        ? undefined
        : typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body)
  });

  const payload = await readPayload(response);

  if (!response.ok) {
    const error = new Error(extractMessage(payload, response.status));
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function getCategories() {
  const payload = await requestJson('/api/categories');
  return payload?.data || payload || [];
}

export async function getLocations() {
  const payload = await requestJson('/api/locations');
  return payload?.data || payload || [];
}

export async function getServices(options = {}) {
  const resolvedOptions =
    typeof options === 'string'
      ? { location: options }
      : options && typeof options === 'object'
        ? options
        : {};

  const params = new URLSearchParams();

  if (resolvedOptions.location) {
    params.set('location', String(resolvedOptions.location).trim());
  }

  if (resolvedOptions.category) {
    params.set('category', String(resolvedOptions.category).trim());
  }

  const query = params.toString();
  const endpoint = query ? `/api/services?${query}` : '/api/services';
  const payload = await requestJson(endpoint);

  if (payload?.services && Array.isArray(payload.services)) {
    return payload;
  }

  return payload?.data || payload || [];
}

export async function getServiceRoles(serviceId) {
  const resolvedServiceId = Number(serviceId);

  if (!Number.isInteger(resolvedServiceId) || resolvedServiceId <= 0) {
    return [];
  }

  const payload = await requestJson(`/api/services/${encodeURIComponent(resolvedServiceId)}/roles`);
  return payload?.roles || payload?.data || payload || [];
}

export async function getServiceCatalog() {
  const payload = await requestJson('/api/services/catalog');
  return payload?.services || payload?.data || payload || [];
}

export async function getAvailableInstances(location, serviceIds = []) {
  const resolvedLocation = String(location || '').trim();
  const resolvedServiceIds = Array.from(
    new Set(
      (Array.isArray(serviceIds) ? serviceIds : [])
        .map((serviceId) => Number(serviceId))
        .filter((serviceId) => Number.isInteger(serviceId) && serviceId > 0)
    )
  );

  if (!resolvedLocation || resolvedServiceIds.length === 0) {
    return [];
  }

  const payload = await requestJson(
    `/api/services/available-instances?location=${encodeURIComponent(resolvedLocation)}&serviceIds=${encodeURIComponent(resolvedServiceIds.join(','))}`
  );

  return payload?.instances || payload?.data || payload || [];
}

export async function getAvailableLocations(serviceIds = [], instanceSelections = '') {
  const resolvedServiceIds = Array.from(
    new Set(
      (Array.isArray(serviceIds) ? serviceIds : [])
        .map((serviceId) => Number(serviceId))
        .filter((serviceId) => Number.isInteger(serviceId) && serviceId > 0)
    )
  );

  if (resolvedServiceIds.length === 0) {
    return [];
  }

  const params = new URLSearchParams({
    serviceIds: resolvedServiceIds.join(',')
  });

  if (instanceSelections) {
    params.set('instanceSelections', instanceSelections);
  }

  const payload = await requestJson(`/api/services/available-locations?${params.toString()}`);

  return payload?.locations || payload?.data || payload || [];
}

export async function calculatePricingEstimate(payload) {
  return requestJson('/api/pricing/calculate', {
    method: 'POST',
    body: payload
  });
}

export async function getServicePricing(location = 'eastus') {
  const resolvedLocation = location || 'eastus';
  const payload = await requestJson(
    `/api/services/pricing?location=${encodeURIComponent(resolvedLocation)}`
  );
  return payload?.services || payload?.data || payload || [];
}

export async function getAzurePricing({ service, region, sku } = {}) {
  const params = new URLSearchParams();

  if (service) {
    params.set('service', String(service).trim());
  }

  if (region) {
    params.set('region', String(region).trim());
  }

  if (sku) {
    params.set('sku', String(sku).trim());
  }

  const query = params.toString();
  return requestJson(`/api/pricing${query ? `?${query}` : ''}`);
}

export async function createRequest(payload) {
  const response = await requestJson('/api/requests', {
    method: 'POST',
    body: payload
  });

  const requestId =
    response?.requestId || response?.id || response?.data?.id || response?.request?.id;

  if (!requestId) {
    console.error('create_request_response', response);
    throw new Error('Backend returned no request id');
  }

  return {
    ...response,
    requestId
  };
}

export async function listRequests() {
  const payload = await requestJson('/api/requests');
  return payload?.data || payload || [];
}

export async function getRequestById(requestId) {
  return requestJson(`/api/requests/${encodeURIComponent(requestId)}`);
}

export async function getProvisionStatus(requestId) {
  return requestJson(`/api/provision/request/${encodeURIComponent(requestId)}`);
}

export async function provisionResourceGroup(requestId) {
  return requestJson(`/api/provision/request/${encodeURIComponent(requestId)}`, {
    method: 'POST'
  });
}

export async function getProvisionedServiceResources(requestId) {
  const payload = await requestJson(`/api/provision/request/${encodeURIComponent(requestId)}/services`);
  return payload?.resources || payload?.data || [];
}

export async function provisionServiceResources(requestId) {
  return requestJson(`/api/provision/request/${encodeURIComponent(requestId)}/services`, {
    method: 'POST'
  });
}

export async function getProvisionUsers(requestId) {
  return requestJson(`/api/provision/request/${encodeURIComponent(requestId)}/users`);
}

export async function provisionUsers(requestId) {
  return requestJson(`/api/provision/request/${encodeURIComponent(requestId)}/users`, {
    method: 'POST'
  });
}

export async function getProvisionRoles(requestId) {
  return requestJson(`/api/provision/request/${encodeURIComponent(requestId)}/roles`);
}

export async function provisionRoles(requestId) {
  return requestJson(`/api/provision/request/${encodeURIComponent(requestId)}/roles`, {
    method: 'POST'
  });
}

export async function getCredentialStatus(requestId) {
  return requestJson(`/api/provision/request/${encodeURIComponent(requestId)}/credentials`);
}

export async function sendCredentials(requestId) {
  return requestJson(`/api/provision/request/${encodeURIComponent(requestId)}/send-credentials`, {
    method: 'POST'
  });
}

export async function createProvisioningJob(csvText, { sourceFilename = null } = {}) {
  const response = await fetch(buildUrl('/api/jobs'), {
    cache: 'no-store',
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'text/csv',
      ...(sourceFilename ? { 'x-file-name': sourceFilename } : {})
    },
    body: csvText
  });

  const payload = await readPayload(response);

  if (!response.ok) {
    const error = new Error(extractMessage(payload, response.status));
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function getProvisioningJob(jobId) {
  return requestJson(`/api/jobs/${encodeURIComponent(jobId)}`);
}

export async function exchangeManageToken(token) {
  return requestJson(`/api/manage/token?token=${encodeURIComponent(token)}`);
}

export async function loginManagePortal({ token, username, password }) {
  return requestJson('/api/manage/login', {
    method: 'POST',
    body: {
      token,
      username,
      password
    }
  });
}

export async function getManageRequest(sessionToken, requestId) {
  return requestJson(`/api/manage/request/${encodeURIComponent(requestId)}?session=${encodeURIComponent(sessionToken)}`);
}

export async function deleteManageUser(sessionToken, requestId, userId) {
  return requestJson(`/api/manage/user/${encodeURIComponent(userId)}?session=${encodeURIComponent(sessionToken)}&requestId=${encodeURIComponent(requestId)}`, {
    method: 'DELETE'
  });
}

export async function updateManageUserRoles(sessionToken, requestId, userId, roles) {
  return requestJson(`/api/manage/user/${encodeURIComponent(userId)}/roles?session=${encodeURIComponent(sessionToken)}&requestId=${encodeURIComponent(requestId)}`, {
    method: 'PATCH',
    body: { roles }
  });
}

export const exchangeAccessToken = exchangeManageToken;
export const getAccessUsers = getManageRequest;
export const deleteAccessUser = deleteManageUser;
export const updateAccessUserRoles = updateManageUserRoles;

export async function fetchProvisionSnapshot(requestId) {
  const [request, provision, services, users, roles, credentials] = await Promise.allSettled([
    getRequestById(requestId),
    getProvisionStatus(requestId),
    getProvisionedServiceResources(requestId),
    getProvisionUsers(requestId),
    getProvisionRoles(requestId),
    getCredentialStatus(requestId)
  ]);

  return {
    request: request.status === 'fulfilled' ? request.value : null,
    provision: provision.status === 'fulfilled' ? provision.value : null,
    services: services.status === 'fulfilled' ? services.value : null,
    users: users.status === 'fulfilled' ? users.value : null,
    roles: roles.status === 'fulfilled' ? roles.value : null,
    credentials: credentials.status === 'fulfilled' ? credentials.value : null
  };
}

export async function createRequestWithPricing(payload) {
  const response = await createRequest(payload);
  const requestId = response?.requestId || response?.id || response?.data?.id || response?.request?.id;

  if (!requestId) {
    console.error('create_request_response', response);
    throw new Error('Backend returned no request id');
  }

  return {
    ...response,
    requestId
  };
}

// Usage tracking APIs
export async function startUsageSession(requestId, userId) {
  return requestJson('/api/usage/start', {
    method: 'POST',
    body: { requestId, userId }
  });
}

export async function endUsageSession(requestId, userId) {
  return requestJson('/api/usage/end', {
    method: 'POST',
    body: { requestId, userId }
  });
}

export async function getUsageStatus(requestId, userId) {
  return requestJson(`/api/usage/status/${encodeURIComponent(requestId)}/${encodeURIComponent(userId)}`);
}

export async function getActiveSessions() {
  return requestJson('/api/usage/sessions/active');
}

export async function forceLogoutUser(requestId, userId) {
  return requestJson('/api/usage/force-logout', {
    method: 'POST',
    body: { requestId, userId }
  });
}

const orgAdminHeaders = (sessionToken) => ({
  'x-org-admin-session': sessionToken
});

export async function loginOrgAdmin({ email, username, password }) {
  return requestJson('/api/org-admin/login', {
    method: 'POST',
    body: { email, username, password }
  });
}

export async function listOrgResourceGroups(sessionToken) {
  return requestJson('/api/org-admin/resource-groups', {
    headers: orgAdminHeaders(sessionToken)
  });
}

export async function getOrgResourceGroupDetail(sessionToken, requestId) {
  return requestJson(`/api/org-admin/resource-groups/${encodeURIComponent(requestId)}`, {
    headers: orgAdminHeaders(sessionToken)
  });
}

export async function getOrgMonitoringLogs(sessionToken, requestId, options = {}) {
  const params = new URLSearchParams();

  if (options.userId) {
    params.set('userId', String(options.userId));
  }

  if (options.limit) {
    params.set('limit', String(options.limit));
  }

  const query = params.toString();
  const path = query
    ? `/api/org-admin/resource-groups/${encodeURIComponent(requestId)}/monitoring?${query}`
    : `/api/org-admin/resource-groups/${encodeURIComponent(requestId)}/monitoring`;

  return requestJson(path, {
    headers: orgAdminHeaders(sessionToken)
  });
}

export async function deleteOrgAdminUser(sessionToken, requestId, userId) {
  return requestJson(
    `/api/org-admin/resource-groups/${encodeURIComponent(requestId)}/users/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      headers: orgAdminHeaders(sessionToken)
    }
  );
}

export async function updateOrgAdminUserRoles(sessionToken, requestId, userId, roles) {
  return requestJson(
    `/api/org-admin/resource-groups/${encodeURIComponent(requestId)}/users/${encodeURIComponent(userId)}/roles`,
    {
      method: 'PATCH',
      headers: orgAdminHeaders(sessionToken),
      body: { roles }
    }
  );
}

export async function createAdminAccessRequest(payload) {
  return requestJson('/api/admin-access-requests', {
    method: 'POST',
    body: payload
  });
}

export async function listOrgAccessRequests(sessionToken, options = {}) {
  const params = new URLSearchParams();

  if (options.status) {
    params.set('status', String(options.status));
  }

  if (options.requestId) {
    params.set('requestId', String(options.requestId));
  }

  const query = params.toString();
  const path = query ? `/api/org-admin/access-requests?${query}` : '/api/org-admin/access-requests';

  return requestJson(path, {
    headers: orgAdminHeaders(sessionToken)
  });
}

export async function reviewOrgAccessRequest(sessionToken, id, payload) {
  return requestJson(`/api/org-admin/access-requests/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: orgAdminHeaders(sessionToken),
    body: payload
  });
}

export async function forceOrgAdminLogout(sessionToken, requestId, userId) {
  return requestJson(
    `/api/org-admin/resource-groups/${encodeURIComponent(requestId)}/users/${encodeURIComponent(userId)}/force-logout`,
    {
      method: 'POST',
      headers: orgAdminHeaders(sessionToken)
    }
  );
}
