const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const { createGraphClient } = require('../provisioners/azure/userProvisioner');
const {
  batchAddUsersToGroups
} = require('../provisioners/azure/graphBatchProvisioner');
const {
  buildResourceGroupScope,
  createAuthorizationClient,
  createRoleAssignmentWithRetry,
  findMatchingRoleDefinition,
  roleAssignmentIdFromSeed
} = require('../provisioners/azure/roleProvisioner');

let userRoleAssignmentSchemaCache = null;
let serviceRoleMappingSchemaCache = null;

const getUserRoleAssignmentSchema = async () => {
  if (userRoleAssignmentSchemaCache) {
    return userRoleAssignmentSchemaCache;
  }

  const result = await db.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'user_role_assignments'
    `
  );

  const columns = new Set(result.rows.map((row) => row.column_name));
  userRoleAssignmentSchemaCache = {
    hasAssignmentKind: columns.has('assignment_kind'),
    hasAssignmentStatus: columns.has('assignment_status'),
    hasEntraGroupId: columns.has('entra_group_id')
  };

  return userRoleAssignmentSchemaCache;
};

const getServiceRoleMappingSchema = async () => {
  if (serviceRoleMappingSchemaCache) {
    return serviceRoleMappingSchemaCache;
  }

  const result = await db.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'service_role_mapping'
    `
  );

  const columns = new Set(result.rows.map((row) => row.column_name));
  serviceRoleMappingSchemaCache = {
    hasEntraGroupId: columns.has('entra_group_id'),
    hasAssignmentMode: columns.has('assignment_mode')
  };

  return serviceRoleMappingSchemaCache;
};

const getRequestContext = async (client, requestId) => {
  const result = await client.query(
    `
      SELECT
        id,
        account_count,
        status,
        azure_resource_group_name
      FROM requests
      WHERE id = $1
      FOR UPDATE
    `,
    [requestId]
  );

  return result.rows[0] || null;
};

const getAzureUsersForRequest = async (client, requestId) => {
  const result = await client.query(
    `
      SELECT
        id,
        request_id,
        azure_user_id,
        username
      FROM azure_users
      WHERE request_id = $1
        AND COALESCE(is_deleted, FALSE) = FALSE
      ORDER BY username
    `,
    [requestId]
  );

  return result.rows;
};

const getSelectedRolesForRequest = async (client, requestId) => {
  const schema = await getServiceRoleMappingSchema();
  const entraGroupIdExpression = schema.hasEntraGroupId
    ? 'srm.entra_group_id'
    : 'NULL::text AS entra_group_id';
  const assignmentModeExpression = schema.hasAssignmentMode
    ? "COALESCE(srm.assignment_mode, 'rbac') AS assignment_mode"
    : "'rbac'::text AS assignment_mode";

  const result = await client.query(
    `
      SELECT
        rsr.service_id,
        rsr.azure_role,
        ${entraGroupIdExpression},
        ${assignmentModeExpression}
      FROM request_service_roles rsr
      LEFT JOIN service_role_mapping srm
        ON srm.service_id = rsr.service_id
       AND LOWER(srm.azure_role) = LOWER(rsr.azure_role)
      WHERE rsr.request_id = $1
      ORDER BY rsr.azure_role
    `,
    [requestId]
  );

  return result.rows.map((row) => ({
    serviceId: Number(row.service_id),
    azureRole: row.azure_role,
    entraGroupId: row.entra_group_id,
    assignmentMode: String(row.assignment_mode || 'rbac').trim().toLowerCase()
  }));
};

const getExistingAssignments = async (client, requestId, userId) => {
  const result = await client.query(
    `
      SELECT azure_role
      FROM user_role_assignments
      WHERE request_id = $1
        AND user_id = $2
    `,
    [requestId, userId]
  );

  return result.rows;
};

const upsertUserAssignment = async (client, data) => {
  const schema = await getUserRoleAssignmentSchema();
  const columns = [
    'assignment_id',
    'request_id',
    'user_id',
    'role_definition_id',
    'role',
    'azure_role',
    'scope',
    'status',
    'assigned_at',
    'created_at'
  ];
  const values = [
    data.assignmentId,
    data.requestId,
    data.userId,
    data.roleDefinitionId || null,
    data.role || data.azureRole,
    data.azureRole,
    data.scope,
    data.status || 'assigned',
    data.assignedAt,
    new Date()
  ];

  if (schema.hasAssignmentKind) {
    columns.push('assignment_kind');
    values.push(data.assignmentKind || 'rbac');
  }

  if (schema.hasEntraGroupId) {
    columns.push('entra_group_id');
    values.push(data.entraGroupId || null);
  }

  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const columnList = columns.join(', ');

  await client.query(
    `
      INSERT INTO user_role_assignments (${columnList})
      SELECT ${placeholders}
      WHERE NOT EXISTS (
        SELECT 1
        FROM user_role_assignments
        WHERE request_id = $2
          AND user_id = $3
          AND azure_role = $6
      )
    `,
    values
  );
};

const getUserRoleAssignmentsForRequest = async (requestId) => {
  try {
    const schema = await getUserRoleAssignmentSchema();
    const assignmentKindExpression = schema.hasAssignmentKind
      ? 'ura.assignment_kind'
      : schema.hasAssignmentStatus
        ? 'ura.assignment_status AS assignment_kind'
        : "ura.status AS assignment_kind";
    const entraGroupIdExpression = schema.hasEntraGroupId
      ? 'ura.entra_group_id'
      : 'NULL::text AS entra_group_id';

    const result = await db.query(
      `
        SELECT
          ura.assignment_id,
          ura.azure_role,
          ura.scope,
          ura.assigned_at,
          ${assignmentKindExpression},
          ${entraGroupIdExpression},
          au.username,
          au.azure_user_id,
          s.name AS service_name
        FROM user_role_assignments ura
        LEFT JOIN azure_users au
          ON au.id = ura.user_id
        LEFT JOIN request_service_roles rsr
          ON rsr.request_id = ura.request_id
         AND rsr.azure_role = ura.azure_role
        LEFT JOIN services s
          ON s.id = rsr.service_id
        WHERE ura.request_id = $1
        ORDER BY au.username, s.name, ura.azure_role
      `,
      [requestId]
    );

    return result.rows;
  } catch (error) {
    console.error('Role assignment query failed');
    console.error(error);
    throw error;
  }
};

const provisionRolesForRequest = async (requestId) => {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const request = await getRequestContext(client, requestId);

    if (!request) {
      throw new AppError('Request not found', 404);
    }

    const users = await getAzureUsersForRequest(client, requestId);
    const roles = await getSelectedRolesForRequest(client, requestId);

    const { authorizationClient, subscriptionId } = createAuthorizationClient();
    const { graphClient } = createGraphClient();
    const scope = buildResourceGroupScope(subscriptionId, request.azure_resource_group_name);

    const groupAssignments = new Map();
    let assigned = 0;

    for (const user of users) {
      const existingAssignments = await getExistingAssignments(client, requestId, user.id);

      for (const role of roles) {
        if (existingAssignments.some((entry) => entry.azure_role === role.azureRole)) {
          continue;
        }

        if (role.assignmentMode === 'group' && role.entraGroupId) {
          if (!groupAssignments.has(role.entraGroupId)) {
            groupAssignments.set(role.entraGroupId, []);
          }

          groupAssignments.get(role.entraGroupId).push(user);

          await upsertUserAssignment(client, {
            requestId,
            userId: user.id,
            assignmentId: roleAssignmentIdFromSeed(
              `${requestId}-${user.id}-${role.azureRole}-${role.entraGroupId}`
            ),
            roleDefinitionId: `group:${role.entraGroupId}`,
            role: role.azureRole,
            azureRole: role.azureRole,
            scope,
            assignedAt: new Date(),
            assignmentKind: 'group',
            status: 'assigned',
            entraGroupId: role.entraGroupId
          });

          assigned += 1;
          continue;
        }

        const definition = await findMatchingRoleDefinition(authorizationClient, scope, role.azureRole);

        if (!definition) {
          continue;
        }

        const assignmentId = roleAssignmentIdFromSeed(`${requestId}-${user.id}-${definition.id}`);

        try {
          await createRoleAssignmentWithRetry(
            authorizationClient,
            scope,
            assignmentId,
            {
              principalId: user.azure_user_id,
              roleDefinitionId: definition.id,
              principalType: 'User'
            },
            requestId
          );
        } catch (error) {
          if (error?.statusCode !== 409 && error?.code !== 'RoleAssignmentExists') {
            throw error;
          }
        }

        await upsertUserAssignment(client, {
          requestId,
          userId: user.id,
          assignmentId,
          roleDefinitionId: definition.id,
          role: role.azureRole,
          azureRole: role.azureRole,
          scope,
          assignedAt: new Date(),
          assignmentKind: 'rbac',
          status: 'assigned',
          entraGroupId: null
        });

        assigned += 1;
      }
    }

    for (const [groupId, members] of groupAssignments.entries()) {
      await batchAddUsersToGroups(graphClient, groupId, members, `request-${requestId}-group-${groupId}`);
    }

    await client.query('COMMIT');

    return {
      success: true,
      usersProcessed: users.length,
      rolesAssigned: assigned
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  provisionRolesForRequest,
  getUserRoleAssignmentsForRequest
};
