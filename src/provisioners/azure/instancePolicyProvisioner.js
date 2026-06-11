const crypto = require('crypto');
const { PolicyClient } = require('@azure/arm-policy');
const { createAzureCredential, validateAzureEnv } = require('../../config/azure');
const { findInstancePolicyRule } = require('../../utils/instancePolicyRules');
const { ensureCustomPolicyDefinition } = require('./customPolicyProvisioner');

const logEvent = (event, details = {}) => {
  console.log(
    JSON.stringify({
      event,
      service: 'azure-instance-policy-provisioner',
      timestamp: new Date().toISOString(),
      ...details
    })
  );
};

const sanitizeAssignmentName = (seed) => {
  const hash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 20);
  return `pol${hash}`;
};

const createPolicyClient = () => {
  const azureConfig = validateAzureEnv();
  const credential = createAzureCredential(azureConfig);

  return {
    policyClient: new PolicyClient(credential, azureConfig.subscriptionId),
    subscriptionId: azureConfig.subscriptionId
  };
};

const buildResourceGroupScope = (subscriptionId, resourceGroupName) =>
  `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`;

const isPolicyAlreadyExistsError = (error) =>
  Number(error?.statusCode || error?.status) === 409 ||
  String(error?.code || '').toLowerCase() === 'policyassignmentexists';

const assignPolicyWithRetry = async ({
  policyClient,
  scope,
  assignmentName,
  parameters,
  requestId,
  allowUpdate = false
}) => {
  try {
    return await policyClient.policyAssignments.create(scope, assignmentName, parameters);
  } catch (error) {
    if (!isPolicyAlreadyExistsError(error)) {
      throw error;
    }

    if (!allowUpdate) {
      logEvent('instance_policy_assignment_exists', { requestId, scope, assignmentName });
      return null;
    }

    logEvent('instance_policy_assignment_update_started', { requestId, scope, assignmentName });
    return policyClient.policyAssignments.create(scope, assignmentName, parameters);
  }
};

const getExistingAssignmentSkus = async ({
  policyClient,
  scope,
  assignmentName,
  parameterName = 'listOfAllowedSKUs'
}) => {
  try {
    const existing = await policyClient.policyAssignments.get(scope, assignmentName);
    const values = existing?.parameters?.[parameterName]?.value;
    return Array.isArray(values) ? values.map((value) => String(value)) : [];
  } catch (error) {
    if (Number(error?.statusCode || error?.status) === 404) {
      return [];
    }

    throw error;
  }
};

const resolvePolicyDefinitionId = async (rule) => {
  if (rule.policyDefinitionId) {
    return rule.policyDefinitionId;
  }

  if (rule.customPolicyKey) {
    return ensureCustomPolicyDefinition(rule.customPolicyKey);
  }

  return null;
};

const configureServiceInstancePolicy = async ({
  policyClient,
  scope,
  requestId,
  serviceId,
  serviceName,
  instanceOption
}) => {
  const rule = findInstancePolicyRule(serviceName);

  if (!rule) {
    logEvent('instance_policy_configure_metadata_only', {
      requestId,
      serviceId,
      serviceName,
      reason: 'no_azure_policy_rule'
    });

    return {
      resourceType: 'Microsoft.Authorization/policyAssignments',
      resourceName: `instance-policy-${serviceId}`,
      policyType: 'instance_metadata',
      azureResourceId: scope,
      status: 'policy_configured',
      errorMessage: null
    };
  }

  const policyDefinitionId = await resolvePolicyDefinitionId(rule);
  if (!policyDefinitionId) {
    throw new Error(`No policy definition configured for ${rule.policyType}`);
  }

  const requestedSkus = rule.resolveAllowedSkus(instanceOption);
  const assignmentSeed = rule.mergeAssignments
    ? `${requestId}-${rule.policyType}`
    : `${requestId}-${serviceId}-${rule.policyType}`;
  const assignmentName = sanitizeAssignmentName(assignmentSeed);

  const allowedParameterName = rule.allowedParameterName || 'listOfAllowedSKUs';

  let allowedSkus = requestedSkus;
  if (rule.mergeAssignments) {
    const existingSkus = await getExistingAssignmentSkus({
      policyClient,
      scope,
      assignmentName,
      parameterName: allowedParameterName
    });
    allowedSkus = Array.from(new Set([...existingSkus, ...requestedSkus]));
  }

  const built = rule.buildParameters(instanceOption, allowedSkus);

  await assignPolicyWithRetry({
    policyClient,
    scope,
    assignmentName,
    requestId,
    allowUpdate: Boolean(rule.mergeAssignments),
    parameters: {
      displayName: `${built.displayNameSuffix} (request ${requestId})`,
      policyDefinitionId,
      parameters: built.parameters
    }
  });

  return {
    resourceType: 'Microsoft.Authorization/policyAssignments',
    resourceName: assignmentName,
    policyType: rule.policyType,
    azureResourceId: scope,
    status: 'policy_configured',
    errorMessage: null
  };
};

const configureInstancePolicy = async ({
  requestId,
  serviceId,
  serviceName,
  resourceGroupName,
  instanceOption
}) => {
  const { policyClient, subscriptionId } = createPolicyClient();
  const scope = buildResourceGroupScope(subscriptionId, resourceGroupName);

  logEvent('instance_policy_configure_started', {
    requestId,
    serviceId,
    serviceName,
    instanceOption,
    resourceGroupName,
    scope
  });

  const policyResult = await configureServiceInstancePolicy({
    policyClient,
    scope,
    requestId,
    serviceId,
    serviceName,
    instanceOption
  });

  logEvent('instance_policy_configure_success', {
    requestId,
    serviceId,
    serviceName,
    policyType: policyResult.policyType,
    scope
  });

  return policyResult;
};

module.exports = {
  configureInstancePolicy
};
