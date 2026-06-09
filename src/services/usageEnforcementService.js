const { ComputeManagementClient } = require('@azure/arm-compute');
const { ContainerServiceClient } = require('@azure/arm-containerservice');
const { WebSiteManagementClient } = require('@azure/arm-appservice');
const { AuthorizationManagementClient } = require('@azure/arm-authorization');
const { createAzureCredential, validateAzureEnv } = require('../config/azure');
const db = require('../db/postgres');
const AppError = require('../utils/AppError');

/**
 * Enforce usage limit by revoking Azure access or stopping resources
 */
async function enforceUsageLimit({ requestId, userId }) {
  try {
    console.log(`Enforcing usage limit for request ${requestId}, user ${userId}`);

    // Get request and user details
    const result = await db.query(
      `
      SELECT 
        r.id as request_id,
        r.location,
        r.enforce_in_azure,
        au.id as user_id,
        au.azure_user_id,
        au.principal_id,
        au.resource_group_name,
        au.used_today_minutes,
        r.daily_limit_minutes
      FROM requests r
      JOIN azure_users au ON au.request_id = r.id
      WHERE r.id = $1 AND au.id = $2
      `,
      [requestId, userId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Request or user not found.', 404);
    }

    const data = result.rows[0];

    // Check if enforcement in Azure is enabled
    if (!data.enforce_in_azure) {
      console.log(`Azure enforcement disabled for request ${requestId}. Skipping.`);
      return {
        success: true,
        message: 'Azure enforcement is disabled for this request.',
        enforced: false
      };
    }

    // Verify user exceeded limit
    const usedMinutes = Number(data.used_today_minutes || 0);
    const limitMinutes = Number(data.daily_limit_minutes || 0);

    if (usedMinutes < limitMinutes) {
      console.log(`[ENFORCEMENT] User ${userId} has not exceeded limit. Skipping enforcement.`);
      return {
        success: true,
        message: 'User has not exceeded daily limit.',
        enforced: false
      };
    }

    console.log(`[ENFORCEMENT] User ${userId} exceeded limit: ${usedMinutes}/${limitMinutes} minutes - revoking access and forcing logout`);

    // Initialize Azure clients
    const azureConfig = validateAzureEnv();
    const credential = createAzureCredential(azureConfig);

    // Force logout by revoking Azure RBAC role assignments (DO NOT delete user)
    const roleAssignmentsRevoked = await revokeRoleAssignments({
      credential,
      subscriptionId: azureConfig.subscriptionId,
      resourceGroupName: data.resource_group_name,
      principalId: data.principal_id,
      requestId,
      userId
    });

    // Stop Azure resources (VMs, AKS, App Services) to force logout
    const resourcesStopped = await stopAzureResources({
      credential,
      subscriptionId: azureConfig.subscriptionId,
      resourceGroupName: data.resource_group_name,
      location: data.location,
      requestId,
      userId
    });

    // Log enforcement action
    await db.query(
      `
      INSERT INTO usage_enforcement_logs (
        request_id,
        user_id,
        action,
        details,
        created_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      `,
      [
        requestId,
        userId,
        'limit_exceeded_forced_logout',
        JSON.stringify({
          roleAssignmentsRevoked,
          resourcesStopped,
          usedMinutes,
          limitMinutes,
          action: 'forced_logout_and_revoke_access'
        })
      ]
    );

    console.log(`[ENFORCEMENT] Access revoked and user ${userId} forced logout. User account preserved.`);

    return {
      success: true,
      message: 'Usage limit enforced in Azure. Access revoked but user account preserved.',
      enforced: true,
      details: {
        roleAssignmentsRevoked,
        resourcesStopped
      }
    };
  } catch (error) {
    console.error('Error enforcing usage limit:', error);
    
    // Log error but don't throw - enforcement failures shouldn't break the flow
    try {
      await db.query(
        `
        INSERT INTO usage_enforcement_logs (
          request_id,
          user_id,
          action,
          details,
          created_at
        )
        VALUES ($1, $2, $3, $4, NOW())
        `,
        [
          requestId,
          userId,
          'enforcement_error',
          JSON.stringify({
            error: error.message,
            stack: error.stack
          })
        ]
      );
    } catch (logError) {
      console.error('Error logging enforcement failure:', logError);
    }

    return {
      success: false,
      message: error.message,
      enforced: false
    };
  }
}

/**
 * Revoke Azure RBAC role assignments for a principal
 */
async function revokeRoleAssignments({
  credential,
  subscriptionId,
  resourceGroupName,
  principalId,
  requestId,
  userId
}) {
  if (!resourceGroupName || !principalId) {
    console.log('Missing resource group or principal ID. Skipping role revocation.');
    return [];
  }

  try {
    const authClient = new AuthorizationManagementClient(credential, subscriptionId);
    const scope = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`;

    // List all role assignments for this principal in the resource group
    const roleAssignments = [];
    for await (const assignment of authClient.roleAssignments.listForScope(scope)) {
      if (assignment.principalId === principalId) {
        roleAssignments.push(assignment);
      }
    }

    console.log(`Found ${roleAssignments.length} role assignments for user ${userId}`);

    // Delete each role assignment
    const revoked = [];
    for (const assignment of roleAssignments) {
      try {
        await authClient.roleAssignments.deleteById(assignment.id);
        revoked.push({
          roleAssignmentId: assignment.id,
          roleDefinitionId: assignment.roleDefinitionId,
          scope: assignment.scope
        });
        console.log(`Revoked role assignment: ${assignment.id}`);
      } catch (error) {
        console.error(`Error revoking role assignment ${assignment.id}:`, error.message);
      }
    }

    return revoked;
  } catch (error) {
    console.error('Error revoking role assignments:', error);
    return [];
  }
}

/**
 * Stop Azure resources (VMs, AKS, App Services) in the resource group
 */
async function stopAzureResources({
  credential,
  subscriptionId,
  resourceGroupName,
  location,
  requestId,
  userId
}) {
  if (!resourceGroupName) {
    console.log('Missing resource group name. Skipping resource stop.');
    return [];
  }

  const stopped = [];

  try {
    // Stop VMs
    const computeClient = new ComputeManagementClient(credential, subscriptionId);
    try {
      for await (const vm of computeClient.virtualMachines.list(resourceGroupName)) {
        try {
          console.log(`Stopping VM: ${vm.name}`);
          await computeClient.virtualMachines.beginDeallocateAndWait(resourceGroupName, vm.name);
          stopped.push({
            type: 'VirtualMachine',
            name: vm.name,
            action: 'deallocate'
          });
        } catch (error) {
          console.error(`Error stopping VM ${vm.name}:`, error.message);
        }
      }
    } catch (error) {
      console.error('Error listing VMs:', error.message);
    }

    // Stop AKS clusters
    const aksClient = new ContainerServiceClient(credential, subscriptionId);
    try {
      for await (const cluster of aksClient.managedClusters.listByResourceGroup(resourceGroupName)) {
        try {
          console.log(`Stopping AKS cluster: ${cluster.name}`);
          await aksClient.managedClusters.beginStopAndWait(resourceGroupName, cluster.name);
          stopped.push({
            type: 'AKSCluster',
            name: cluster.name,
            action: 'stop'
          });
        } catch (error) {
          console.error(`Error stopping AKS cluster ${cluster.name}:`, error.message);
        }
      }
    } catch (error) {
      console.error('Error listing AKS clusters:', error.message);
    }

    // Stop App Services
    const webClient = new WebSiteManagementClient(credential, subscriptionId);
    try {
      for await (const site of webClient.webApps.listByResourceGroup(resourceGroupName)) {
        try {
          console.log(`Stopping App Service: ${site.name}`);
          await webClient.webApps.stop(resourceGroupName, site.name);
          stopped.push({
            type: 'AppService',
            name: site.name,
            action: 'stop'
          });
        } catch (error) {
          console.error(`Error stopping App Service ${site.name}:`, error.message);
        }
      }
    } catch (error) {
      console.error('Error listing App Services:', error.message);
    }
  } catch (error) {
    console.error('Error stopping Azure resources:', error);
  }

  return stopped;
}

module.exports = {
  enforceUsageLimit
};
