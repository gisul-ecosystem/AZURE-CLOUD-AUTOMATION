require('dotenv').config();
const db = require('./src/db/postgres');

async function debugRoles(requestId) {
  try {
    console.log(`\n=== Debugging Role Provisioning for Request ${requestId} ===\n`);

    // Check request details
    const request = await db.query(
      'SELECT id, status, azure_resource_group_name FROM requests WHERE id = $1',
      [requestId]
    );
    console.log('Request:', request.rows[0]);

    // Check users
    const users = await db.query(
      'SELECT id, username, azure_user_id FROM azure_users WHERE request_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE',
      [requestId]
    );
    console.log('\nUsers found:', users.rows.length);
    console.log('Users:', users.rows);

    // Check selected roles
    const roles = await db.query(`
      SELECT 
        rsr.service_id,
        rsr.azure_role,
        srm.entra_group_id,
        COALESCE(srm.assignment_mode, 'rbac') AS assignment_mode
      FROM request_service_roles rsr
      LEFT JOIN service_role_mapping srm ON srm.service_id = rsr.service_id AND LOWER(srm.azure_role) = LOWER(rsr.azure_role)
      WHERE rsr.request_id = $1
    `, [requestId]);
    console.log('\nSelected roles found:', roles.rows.length);
    console.log('Selected roles:', roles.rows);

    // Check existing assignments
    const assignments = await db.query(
      'SELECT user_id, azure_role FROM user_role_assignments WHERE request_id = $1',
      [requestId]
    );
    console.log('\nExisting assignments found:', assignments.rows.length);
    console.log('Existing assignments:', assignments.rows);

    await db.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

const requestId = process.argv[2] || 1;
debugRoles(requestId);
