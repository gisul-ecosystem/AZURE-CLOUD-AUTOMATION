const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const {
  buildResourceGroupScope,
  createAuthorizationClient,
  createRoleAssignmentWithRetry,
  findMatchingRoleDefinition,
  getExistingAzureAssignment,
  logAzureRoleEvent,
  roleAssignmentIdFromSeed
} = require('../provisioners/azure/roleProvisioner');

const validateRequiredId = (value, fieldName) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new AppError(`${fieldName} is required.`, 400);
  }
};

const getRequestContext = async (client, requestId) => {
  validateRequiredId(requestId, 'request_id');

  const query = `
    SELECT
      id,
      status,
      account_count,
      azure_resource_group_name
    FROM requests
    WHERE id = $1
    FOR UPDATE
  `;

  const result = await client.query(query, [requestId]);
  return result.rows[0] || null;
};

const getAzureUsersForRequest = async (client, requestId) => {
  const query = `
    SELECT id, request_id, azure_user_id, username
    FROM azure_users
    WHERE request_id = $1
    ORDER BY username ASC
  `;

  const result = await client.query(query, [requestId]);
  return result.rows;
};

const getSelectedServicesForRequest = async (client, requestId) => {
  const query = `
    SELECT DISTINCT
      s.id,
      s.name,
      s.azure_role
    FROM request_services rs
    INNER JOIN services s ON s.id = rs.service_id
    WHERE rs.request_id = $1
    ORDER BY s.id ASC
  `;

  const result = await client.query(query, [requestId]);
  return result.rows;
};

const getServiceRoleMapping = async (client, serviceIds) => {
  if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
    throw new AppError('service_ids is required.', 400);
  }

  logAzureRoleEvent('info', 'service_role_mapping_started', {
    serviceIds
  });

  const query = `
    SELECT
      id,
      service_id,
      azure_role_name
    FROM service_role_mapping
    WHERE service_id = ANY($1)
  `;

  try {
    const result = await client.query(query, [serviceIds]);

    if (result.rows.length === 0) {
      throw new AppError('Role mapping missing.', 400);
    }

    logAzureRoleEvent('info', 'service_role_mapping_completed', {
      serviceIds,
      mappingCount: result.rows.length
    });

    return result.rows;
  } catch (error) {
    logAzureRoleEvent('error', 'service_role_mapping_failed', {
      serviceIds,
      errorName: error?.name,
      errorCode: error?.code,
      statusCode: error?.statusCode || error?.status,
      message: error?.message
    });

    throw error;
  }
};

const getExistingAssignments = async (client, requestId, azureUserId) => {
  validateRequiredId(requestId, 'request_id');
  validateRequiredId(azureUserId, 'azure_user_id');

  logAzureRoleEvent('info', 'existing_assignment_check_started', {
    requestId,
    azureUserId
  });

  const query = `
    SELECT
      ura.id,
      ura.user_id,
      ura.azure_role,
      ura.scope,
      ura.assignment_id,
      ura.request_id,
      au.azure_user_id
    FROM user_role_assignments ura
    INNER JOIN azure_users au
      ON au.id = ura.user_id
    WHERE ura.request_id = $1
      AND au.azure_user_id = $2
    ORDER BY ura.id ASC
  `;

  try {
    const result = await client.query(query, [requestId, azureUserId]);

    logAzureRoleEvent('info', 'existing_assignment_check_completed', {
      requestId,
      azureUserId,
      assignmentCount: result.rows.length
    });

    return result.rows;
  } catch (error) {
    logAzureRoleEvent('error', 'existing_assignment_check_failed', {
      requestId,
      azureUserId,
      errorName: error?.name,
      errorCode: error?.code,
      statusCode: error?.statusCode || error?.status,
      message: error?.message
    });

    throw error;
  }
};

const upsertUserAssignment = async (client, assignment) => {
  const query = `
    INSERT INTO user_role_assignments (
      request_id,
      user_id,
      azure_role,
      scope,
      assignment_id,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING assignment_id
  `;

  await client.query(query, [
    assignment.requestId,
    assignment.userId,
    assignment.azureRole,
    assignment.scope,
    assignment.assignmentId
  ]);
};

const getUserRoleAssignmentsForRequest = async (requestId) => {
  validateRequiredId(requestId, 'request_id');

  const query = `
    SELECT
      ura.id,
      ura.user_id,
      ura.azure_role,
      ura.scope,
      ura.assignment_id,
      ura.request_id,
      au.azure_user_id
    FROM user_role_assignments ura
    INNER JOIN azure_users au
      ON au.id = ura.user_id
    WHERE ura.request_id = $1
    ORDER BY au.azure_user_id ASC, ura.azure_role ASC
  `;

  const result = await db.query(query, [requestId]);

  return result.rows.map((row) => ({
    id: row.id,
    requestId: row.request_id,
    userId: row.user_id,
    azureUserId: row.azure_user_id,
    azureRole: row.azure_role,
    assignmentId: row.assignment_id,
    scope: row.scope,
  }));
};

const provisionRolesForRequest = async (requestId) => {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const request = await getRequestContext(client, requestId);

    if (!request) {
      throw new AppError('Request not found.', 404);
    }

    const accountCount = Number(request.account_count);

    if (!Number.isInteger(accountCount) || accountCount <= 0) {
      throw new AppError('Request account count is invalid.', 400);
    }

    if (typeof request.azure_resource_group_name !== 'string' || request.azure_resource_group_name.trim() === '') {
      throw new AppError('Request does not have a provisioned resource group.', 400);
    }

    const azureUsers = await getAzureUsersForRequest(client, requestId);
    if (azureUsers.length === 0) {
      throw new AppError('No Azure users have been provisioned for this request.', 400);
    }

    const selectedServices = await getSelectedServicesForRequest(client, requestId);
    if (selectedServices.length === 0) {
      throw new AppError('No services are associated with this request.', 400);
    }

    const { authorizationClient, subscriptionId } = createAuthorizationClient();
    const scope = buildResourceGroupScope(
      subscriptionId,
      request.azure_resource_group_name.trim()
    );

    const resolvedRoles = [];
    const resolvedRoleIds = new Set();
    const selectedServiceIds = selectedServices.map((service) => service.id);
    const serviceRoleMappings = await getServiceRoleMapping(client, selectedServiceIds);
    const serviceRoleMappingById = new Map(
      serviceRoleMappings.map((mapping) => [mapping.service_id, mapping])
    );

    for (const service of selectedServices) {
      const mapping = serviceRoleMappingById.get(service.id);
      const roleName = mapping?.azure_role_name || null;

      if (!roleName) {
        throw new AppError('Role mapping missing.', 400);
      }

      const roleDefinition = await findMatchingRoleDefinition(authorizationClient, scope, roleName);

      if (!roleDefinition?.id) {
        throw new AppError(`Unable to resolve Azure role "${roleName}" at the resource group scope.`, 404);
      }

      if (!resolvedRoleIds.has(roleDefinition.id)) {
        resolvedRoleIds.add(roleDefinition.id);
        resolvedRoles.push({
          azureRole: roleName,
          roleDefinitionId: roleDefinition.id
        });
      }
    }

    if (resolvedRoles.length === 0) {
      throw new AppError('No Azure roles could be resolved for the selected services.', 400);
    }

    logAzureRoleEvent('info', 'azure_role_provision_started', {
      requestId,
      subscriptionId,
      scope,
      usersProcessed: azureUsers.length,
      selectedServices: selectedServices.length,
      resolvedRoles: resolvedRoles.length
    });

    let rolesAssigned = 0;

    for (const user of azureUsers) {
      const existingAssignments = await getExistingAssignments(client, requestId, user.azure_user_id);
      const existingAssignmentIds = new Set(existingAssignments.map((row) => row.assignment_id));
      const existingAssignmentCount = existingAssignments.length;
      const expectedAssignmentCount = resolvedRoles.length;

      if (existingAssignmentCount === expectedAssignmentCount) {
        continue;
      }

      if (existingAssignmentCount > 0 && existingAssignmentCount !== expectedAssignmentCount) {
        throw new AppError(
          `Partial role assignments already exist for Azure user ${user.azure_user_id}. Manual review is required.`,
          409
        );
      }

      for (const role of resolvedRoles) {
        const assignmentSeed = [requestId, user.id, role.roleDefinitionId, scope].join(':');
        const assignmentId = roleAssignmentIdFromSeed(assignmentSeed);

        if (existingAssignmentIds.has(assignmentId)) {
          continue;
        }

        const existingAzureAssignment = await getExistingAzureAssignment(
          authorizationClient,
          scope,
          assignmentId
        );

        if (!existingAzureAssignment) {
          await createRoleAssignmentWithRetry(
            authorizationClient,
            scope,
            assignmentId,
            {
              principalId: user.azure_user_id,
              roleDefinitionId: role.roleDefinitionId,
              principalType: 'User'
            },
            requestId
          );
        }

        await upsertUserAssignment(client, {
          requestId,
          userId: user.id,
          azureRole: role.azureRole,
          assignmentId,
          scope
        });

        existingAssignmentIds.add(assignmentId);
        rolesAssigned += 1;
      }
    }

    await client.query('COMMIT');

    logAzureRoleEvent('info', 'azure_role_provision_success', {
      requestId,
      subscriptionId,
      usersProcessed: azureUsers.length,
      rolesAssigned
    });

    return {
      usersProcessed: azureUsers.length,
      rolesAssigned
    };
  } catch (error) {
    await client.query('ROLLBACK');

    logAzureRoleEvent('error', 'azure_role_provision_failed', {
      requestId,
      errorName: error?.name,
      errorCode: error?.code,
      statusCode: error?.statusCode || error?.status,
      message: error?.message
    });

    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  getUserRoleAssignmentsForRequest,
  provisionRolesForRequest
};
