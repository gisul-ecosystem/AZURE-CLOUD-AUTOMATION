const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const { createGraphClient } = require('../provisioners/azure/userProvisioner');
const { batchAddUsersToGroups } = require('../provisioners/azure/graphBatchProvisioner');
const {
  buildResourceGroupScope,
  createAuthorizationClient,
  createRoleAssignmentWithRetry,
  findMatchingRoleDefinition,
  roleAssignmentIdFromSeed
} = require('../provisioners/azure/roleProvisioner');

// ─── Helpers ────────────────────────────────────────────────────────────────

const getRequestContext = async (client, requestId) => {
  const result = await client.query(
    `SELECT id, account_count, status, azure_resource_group_name
     FROM requests WHERE id = $1`,
    [requestId]
  );
  return result.rows[0] || null;
};

const getAzureUsersForRequest = async (client, requestId) => {
  const result = await client.query(
    `SELECT id, request_id, azure_user_id, username
     FROM azure_users
     WHERE request_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE
     ORDER BY username`,
    [requestId]
  );
  return result.rows;
};

const getSelectedRolesForRequest = async (client, requestId) => {
  const result = await client.query(
    `SELECT
       rsr.service_id,
       rsr.azure_role,
       srm.entra_group_id,
       COALESCE(srm.assignment_mode, 'rbac') AS assignment_mode
     FROM request_service_roles rsr
     LEFT JOIN service_role_mapping srm
       ON srm.service_id = rsr.service_id
      AND LOWER(srm.azure_role) = LOWER(rsr.azure_role)
     WHERE rsr.request_id = $1
     ORDER BY rsr.azure_role`,
    [requestId]
  );

  return result.rows.map((row) => ({
    serviceId: Number(row.service_id),
    azureRole: row.azure_role,
    entraGroupId: row.entra_group_id,
    assignmentMode: String(row.assignment_mode || 'rbac').trim().toLowerCase()
  }));
};

// Fetch ALL existing assignments for ALL users in one query
const getAllExistingAssignments = async (client, requestId, userIds) => {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return new Map();
  }

  const result = await client.query(
    `SELECT user_id, azure_role
     FROM user_role_assignments
     WHERE request_id = $1 AND user_id = ANY($2)`,
    [requestId, userIds]
  );

  // Build a Set per user: Map<userId, Set<azureRole>>
  const map = new Map();
  for (const row of result.rows) {
    if (!map.has(row.user_id)) map.set(row.user_id, new Set());
    map.get(row.user_id).add(row.azure_role);
  }
  return map;
};

// Batch insert all assignments in one query
const batchUpsertAssignments = async (assignments) => {
  if (assignments.length === 0) return;

  const values = [];
  const placeholders = assignments.map((a, i) => {
    const base = i * 9;
    values.push(
      a.assignmentId,
      a.requestId,
      a.userId,
      a.azureRole,
      a.scope,
      a.status || 'assigned',
      a.assignedAt || new Date(),
      a.assignmentKind || 'rbac',
      a.entraGroupId || null
    );
    return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},NOW())`;
  });

  await db.query(
    `INSERT INTO user_role_assignments
       (assignment_id, request_id, user_id, azure_role, scope,
        assignment_status, assigned_at, assignment_kind, entra_group_id, created_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (request_id, user_id, azure_role) DO NOTHING`,
    values
  );
};

const getUserRoleAssignmentsForRequest = async (requestId) => {
  try {
    const result = await db.query(
      `SELECT
         ura.assignment_id,
         ura.azure_role,
         ura.scope,
         ura.assigned_at,
         ura.assignment_kind,
         ura.entra_group_id,
         ura.assignment_status,
         au.username,
         au.azure_user_id,
         s.name AS service_name
       FROM user_role_assignments ura
       LEFT JOIN azure_users au ON au.id = ura.user_id
       LEFT JOIN request_service_roles rsr
         ON rsr.request_id = ura.request_id AND rsr.azure_role = ura.azure_role
       LEFT JOIN services s ON s.id = rsr.service_id
       WHERE ura.request_id = $1
       ORDER BY au.username, s.name, ura.azure_role`,
      [requestId]
    );
    return result.rows;
  } catch (error) {
    console.error('Role assignment query failed', error);
    throw error;
  }
};

// ─── Main ───────────────────────────────────────────────────────────────────

const CONCURRENCY_LIMIT = 10; // max parallel Azure calls

const runConcurrent = async (tasks, limit) => {
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const p = Promise.resolve().then(() => task()).then((r) => {
      executing.delete(p);
      return r;
    });
    executing.add(p);
    results.push(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
};

const provisionRolesForRequest = async (requestId) => {
  try {
    const request = await getRequestContext(db, requestId);
    if (!request) throw new AppError('Request not found', 404);

    const [users, roles] = await Promise.all([
      getAzureUsersForRequest(db, requestId),
      getSelectedRolesForRequest(db, requestId)
    ]);

    if (users.length === 0 || roles.length === 0) {
      return {
        success: true,
        usersProcessed: users.length,
        rolesAssigned: 0
      };
    }

    const { authorizationClient, subscriptionId } = createAuthorizationClient();
    const { graphClient } = createGraphClient();
    const scope = buildResourceGroupScope(subscriptionId, request.azure_resource_group_name);

    // 1. Fetch ALL existing assignments in one DB round-trip
    const userIds = users.map((u) => u.id);
    const existingMap = await getAllExistingAssignments(db, requestId, userIds);

    // 2. Pre-fetch all unique role definitions in parallel (cached)
    const rbacRoles = roles.filter((r) => r.assignmentMode !== 'group' || !r.entraGroupId);
    const uniqueRoleNames = [...new Set(rbacRoles.map((r) => r.azureRole))];

    const roleDefMap = new Map();
    await Promise.all(
      uniqueRoleNames.map(async (roleName) => {
        const def = await findMatchingRoleDefinition(authorizationClient, scope, roleName);
        if (def) roleDefMap.set(roleName, def);
      })
    );

    // 3. Build all RBAC tasks and group assignments
    const rbacTasks = [];
    const groupAssignments = new Map(); // groupId -> users[]
    const pendingDbInserts = [];

    for (const user of users) {
      const existingRoles = existingMap.get(user.id) || new Set();

      for (const role of roles) {
        if (existingRoles.has(role.azureRole)) continue;

        // Group assignment
        if (role.assignmentMode === 'group' && role.entraGroupId) {
          if (!groupAssignments.has(role.entraGroupId)) {
            groupAssignments.set(role.entraGroupId, []);
          }
          groupAssignments.get(role.entraGroupId).push(user);

          pendingDbInserts.push({
            assignmentId: roleAssignmentIdFromSeed(
              `${requestId}-${user.id}-${role.azureRole}-${role.entraGroupId}`
            ),
            requestId,
            userId: user.id,
            azureRole: role.azureRole,
            scope,
            status: 'assigned',
            assignedAt: new Date(),
            assignmentKind: 'group',
            entraGroupId: role.entraGroupId
          });
          continue;
        }

        // RBAC assignment
        const definition = roleDefMap.get(role.azureRole);
        if (!definition) continue;

        const assignmentId = roleAssignmentIdFromSeed(`${requestId}-${user.id}-${definition.id}`);

        // Collect task for parallel execution
        rbacTasks.push(async () => {
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

          return {
            assignmentId,
            requestId,
            userId: user.id,
            azureRole: role.azureRole,
            scope,
            status: 'assigned',
            assignedAt: new Date(),
            assignmentKind: 'rbac',
            entraGroupId: null
          };
        });
      }
    }

    // 4. Run all RBAC Azure calls in parallel (with concurrency limit)
    const rbacResults = await runConcurrent(rbacTasks, CONCURRENCY_LIMIT);

    for (const result of rbacResults) {
      if (result.status === 'fulfilled' && result.value) {
        pendingDbInserts.push(result.value);
      }
    }

    // 5. Batch insert all DB records in one shot
    await batchUpsertAssignments(pendingDbInserts);

    // 6. Batch group memberships in parallel
    await Promise.all(
      [...groupAssignments.entries()].map(([groupId, members]) =>
        batchAddUsersToGroups(graphClient, groupId, members, `request-${requestId}-group-${groupId}`)
      )
    );

    return {
      success: true,
      usersProcessed: users.length,
      rolesAssigned: pendingDbInserts.length
    };
  } catch (error) {
    throw error;
  }
};

module.exports = {
  getUserRoleAssignmentsForRequest,
  provisionRolesForRequest
};
