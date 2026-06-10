const { Client } = require('@microsoft/microsoft-graph-client');
const { ClientSecretCredential } = require('@azure/identity');
const db = require('../db/postgres');

/**
 * Create Microsoft Graph client with app-only authentication
 */
const createGraphClient = () => {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      '[SIGNIN_MONITOR] Missing required Azure credentials: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET'
    );
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);

  const client = Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken('https://graph.microsoft.com/.default');
        return token.token;
      }
    }
  });

  return client;
};

/**
 * Monitor Azure sign-ins and create sessions automatically
 * Only tracks users created by our provisioning automation
 */
const monitorAzureSignIns = async () => {
  let fetchedCount = 0;
  let trackedCount = 0;
  let azurePortalCount = 0;
  let sessionsCreated = 0;

  try {
    console.log('[SIGNIN_MONITOR] Starting Azure sign-in detection...');

    // STEP 1: Load tracked users once (created by our automation)
    console.log('[SIGNIN_MONITOR] Loading tracked users from provisioning...');
    
    const trackedUsersResult = await db.query(
      `
      SELECT 
        id,
        request_id,
        username,
        azure_user_id,
        blocked_until
      FROM azure_users
      WHERE COALESCE(is_deleted, false) = false
      `
    );

    // Build map for fast lookup: azure_user_id -> user data
    const trackedUsersMap = new Map();
    for (const user of trackedUsersResult.rows) {
      trackedUsersMap.set(user.azure_user_id, user);
    }

    console.log(`[SIGNIN_MONITOR] Tracking ${trackedUsersMap.size} provisioned user(s).`);

    if (trackedUsersMap.size === 0) {
      console.log('[SIGNIN_MONITOR] No provisioned users to track. Exiting.');
      return;
    }

    const client = createGraphClient();

    // Fetch latest sign-ins
    console.log('[SIGNIN_MONITOR] Fetching latest 100 sign-ins...');

    const signIns = await client
      .api('/auditLogs/signIns')
      .top(100)
      .orderby('createdDateTime desc')
      .get();

    if (!signIns || !signIns.value || signIns.value.length === 0) {
      console.log('[SIGNIN_MONITOR] No sign-ins returned from Graph API.');
      return;
    }

    fetchedCount = signIns.value.length;
    console.log(`[SIGNIN_MONITOR] Fetched ${fetchedCount} sign-in(s) from Graph API.`);

    // Process each sign-in
    for (const signIn of signIns.value) {
      const azureUserId = signIn.userId;

      // STEP 2: Immediately filter - only process tracked users
      // DO NOT LOG anything for untracked users
      if (!azureUserId || !trackedUsersMap.has(azureUserId)) {
        continue; // Silent skip - not our provisioned user
      }

      // Skip failed sign-ins
      if (signIn.status?.errorCode !== 0) {
        continue; // Silent skip for failed logins
      }

      trackedCount++;

      // STEP 3: Log ONLY tracked user sign-ins
      console.log(
        `[SIGNIN] ${signIn.userPrincipalName || 'Unknown'} | ` +
        `${signIn.createdDateTime} | ` +
        `App: ${signIn.appDisplayName || 'Unknown'} | ` +
        `Resource: ${signIn.resourceDisplayName || 'Unknown'}`
      );

      // STEP 4: Filter Azure Portal logins only
      const allowedApps = [
        'Microsoft Azure Portal',
        'Azure Portal',
        'Azure Resource Manager',
        'Azure CLI',
        'Azure PowerShell'
      ];

      const allowedResourceKeywords = ['Azure'];
      
      const rejectedKeywords = [
        'Outlook',
        'Exchange',
        'Office',
        'Teams',
        'Microsoft Graph',
        'My Profile'
      ];

      const appDisplayName = signIn.appDisplayName || '';
      const resourceDisplayName = signIn.resourceDisplayName || '';

      // Check if rejected
      const isRejected = rejectedKeywords.some(
        keyword => 
          appDisplayName.includes(keyword) || 
          resourceDisplayName.includes(keyword)
      );

      if (isRejected) {
        console.log(
          `[IGNORED_NON_AZURE_LOGIN] ${signIn.userPrincipalName} - ` +
          `App: "${appDisplayName}" not Azure-related. Skipping.`
        );
        continue;
      }

      // Check if allowed Azure app
      const isAllowedApp = allowedApps.some(app => appDisplayName.includes(app));
      const isAllowedResource = allowedResourceKeywords.some(
        keyword => resourceDisplayName.includes(keyword)
      );

      if (!isAllowedApp && !isAllowedResource) {
        console.log(
          `[IGNORED_NON_AZURE_LOGIN] ${signIn.userPrincipalName} - ` +
          `App: "${appDisplayName}", Resource: "${resourceDisplayName}" not Azure-related. Skipping.`
        );
        continue;
      }

      azurePortalCount++;

      const userPrincipalName = signIn.userPrincipalName;
      const loginTime = new Date(signIn.createdDateTime);

      // Get user from map
      const user = trackedUsersMap.get(azureUserId);

      // STEP 5: Log tracked user match
      console.log(
        `[TRACKED_USER] username=${user.username}, request=${user.request_id}`
      );

      // STEP 6: Continue with existing session logic
      
      // Check if user is blocked
      if (user.blocked_until && new Date(user.blocked_until) > new Date()) {
        console.log(
          `[SIGNIN_MONITOR] User ${user.id} is blocked until ${user.blocked_until}. Skipping session creation.`
        );
        continue;
      }

      // Check if active session already exists
      const sessionCheck = await db.query(
        `
        SELECT id
        FROM user_usage_sessions
        WHERE request_id = $1
          AND user_id = $2
          AND logout_at IS NULL
        LIMIT 1
        `,
        [user.request_id, user.id]
      );

      if (sessionCheck.rows.length > 0) {
        console.log(
          `[ACTIVE_SESSION_EXISTS] User ${user.id} already has an active session (ID: ${sessionCheck.rows[0].id}). Skipping.`
        );
        continue;
      }

      // Create new session
      const sessionResult = await db.query(
        `
        INSERT INTO user_usage_sessions (
          request_id,
          user_id,
          login_at,
          last_activity_at,
          tracking_status,
          created_at
        )
        VALUES ($1, $2, $3, NOW(), 'ACTIVE', NOW())
        RETURNING id
        `,
        [user.request_id, user.id, loginTime]
      );

      const sessionId = sessionResult.rows[0].id;

      // Update last sign-in time
      await db.query(
        `
        UPDATE azure_users
        SET last_signin_at = NOW()
        WHERE id = $1
        `,
        [user.id]
      );

      sessionsCreated++;

      console.log(
        `[SESSION_CREATED] Session ${sessionId} created for user ${user.id} (${user.username}) from Azure sign-in at ${loginTime.toISOString()}`
      );
    }

    // STEP 7: Summary
    console.log(
      `[SIGNIN_MONITOR] Completed. Fetched=${fetchedCount}, Tracked=${trackedCount}, AzurePortal=${azurePortalCount}, SessionsCreated=${sessionsCreated}`
    );
  } catch (error) {
    console.error('[SIGNIN_MONITOR] Error monitoring Azure sign-ins:', error.message);

    // Log specific Graph API errors
    if (error.statusCode === 403) {
      console.error(
        '[SIGNIN_MONITOR] Permission denied. Ensure the Azure app has AuditLog.Read.All and Directory.Read.All permissions with admin consent.'
      );
    } else if (error.statusCode === 401) {
      console.error(
        '[SIGNIN_MONITOR] Authentication failed. Check AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET.'
      );
    } else {
      console.error('[SIGNIN_MONITOR] Full error:', error);
    }

    console.log(
      `[SIGNIN_MONITOR] Completed with error. Fetched=${fetchedCount}, Tracked=${trackedCount}, AzurePortal=${azurePortalCount}, SessionsCreated=${sessionsCreated}`
    );
  }
};

module.exports = {
  monitorAzureSignIns
};
