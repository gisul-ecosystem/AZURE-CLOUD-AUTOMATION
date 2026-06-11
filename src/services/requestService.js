
const db = require('../db/postgres');
const pricingService = require('./pricingService');
const { assertProvisionableLocation } = require('./azureLocationService');
const { applyTierRolesToAssignments } = require('./instanceRoleMappingService');
const adminAccessRequestService = require('./adminAccessRequestService');

async function createRequest({
  customerEmail,
  accountCount,
  location,
  serviceIds,
  selectedRoles,
  selectedInstances,
  startDate,
  endDate,
  enableDailyUsage,
  dailyLimitMinutes,
  usageSchedule
}) {

  const client = await db.connect();

  try {

    await client.query('BEGIN');

    assertProvisionableLocation(location);

    // ==========================
    // Resolve incoming serviceIds
    // Supports:
    // services.id
    // service_locations.id
    // ==========================

    const incomingIds =
      Array.isArray(serviceIds)
        ? serviceIds
            .map(Number)
            .filter(Boolean)
        : [];

    if (!incomingIds.length) {
      throw new Error(
        'No services selected'
      );
    }

    let validServiceIds = [];



    // ---------------------------------
    // TRY DIRECT services.id
    // ---------------------------------

    const direct =
      await client.query(
        `
        SELECT
          id,
          name
        FROM services
        WHERE id = ANY($1)
        `,
        [incomingIds]
      );



    if (direct.rows.length) {

      validServiceIds =
        direct.rows.map(
          x =>
            Number(
              x.id
            )
        );

    }

    else {

      // ---------------------------------
      // FALLBACK service_locations
      // ---------------------------------

      const catalog =
        await client.query(
          `
          SELECT
            service_name
          FROM service_locations
          WHERE id = ANY($1)
          `,
          [incomingIds]
        );



      if (!catalog.rows.length) {
        throw new Error(
          'Selected services not found'
        );
      }



      const names =
        [
          ...new Set(

            catalog.rows.map(
              x =>

                String(
                  x.service_name
                )

                  .trim()

                  .toLowerCase()

            )

          )
        ];



      const lookup =
        await client.query(
          `
          SELECT
            id,
            name
          FROM services
          WHERE
          LOWER(
            TRIM(name)
          )
          =
          ANY($1)
          `,
          [names]
        );



      validServiceIds =
        lookup.rows.map(
          x =>
            Number(
              x.id
            )
        );

    }



    if (
      !validServiceIds.length
    ) {
      throw new Error(
        'No services resolved'
      );
    }



    // ==========================
    // Pricing
    // ==========================

    const pricing =
      await pricingService
        .calculatePricing({

          accountCount,

          location,

          startDate,

          endDate,

          serviceIds:
            validServiceIds,

          selectedInstances: Array.isArray(selectedInstances) ? selectedInstances : [],

          selectedRoles: Array.isArray(selectedRoles) ? selectedRoles : []

        });



    const estimatedPrice =
      Number(

        pricing
          .estimatedPrice

        ??

        pricing
          .totalPrice

        ??

        0

      );



    // ==========================
    // Create Request
    // ==========================

    const request =
      await client.query(
        `
        INSERT INTO requests(

          customer_email,

          account_count,

          location,

          expiry_date,

          estimated_price,

          status,

          enable_daily_usage,

          daily_limit_minutes,

          usage_schedule

        )

        VALUES(

          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9

        )

        RETURNING
        id,
        estimated_price
        `,
        [

          customerEmail,

          accountCount,

          location,

          endDate,

          estimatedPrice,

          'Pending',

          enableDailyUsage === true,

          enableDailyUsage === true && dailyLimitMinutes ? Number(dailyLimitMinutes) : null,

          enableDailyUsage === true && usageSchedule ? JSON.stringify(usageSchedule) : null

        ]
      );



    const requestId =
      request.rows[0].id;



    // ==========================
    // Insert request_services
    // ==========================

    for (
      const sid
      of validServiceIds
    ) {

      await client.query(
        `
        INSERT INTO request_services(

          request_id,

          service_id

        )

        VALUES(

          $1,

          $2

        )

        ON CONFLICT
        (
          request_id,
          service_id
        )

        DO NOTHING
        `,
        [

          requestId,

          sid

        ]
      );

    }



    // ==========================
    // Save Selected Instances
    // ==========================

    for (const item of selectedInstances || []) {
      const sid = Number(item.serviceId);
      const instanceOption = String(item.instanceOption || '').trim();

      if (!validServiceIds.includes(sid) || !instanceOption) {
        continue;
      }

      await client.query(
        `
          INSERT INTO request_service_instances (
            request_id,
            service_id,
            instance_option
          )
          VALUES ($1, $2, $3)
          ON CONFLICT (request_id, service_id)
          DO UPDATE SET
            instance_option = EXCLUDED.instance_option
        `,
        [requestId, sid, instanceOption]
      );
    }

    // ==========================
    // Save Selected Roles
    // Auto-append default roles for services with enable_role_selection=false
    // ==========================

    // Get service configurations
    const serviceConfigsResult = await client.query(
      `
      SELECT 
        id,
        name,
        COALESCE(enable_role_selection, true) AS enable_role_selection,
        default_role,
        COALESCE(role_required, true) AS role_required
      FROM services
      WHERE id = ANY($1)
      `,
      [validServiceIds]
    );

    const serviceConfigs = new Map();
    for (const svc of serviceConfigsResult.rows) {
      serviceConfigs.set(Number(svc.id), {
        enable_role_selection: Boolean(svc.enable_role_selection),
        default_role: svc.default_role,
        role_required: Boolean(svc.role_required),
        name: svc.name
      });
    }

    // Build final role assignments
    const roleAssignments = new Map(); // serviceId -> Set of roles

    // First, process explicitly selected roles
    for (const item of (selectedRoles || [])) {
      const sid = Number(item.serviceId);

      if (!validServiceIds.includes(sid)) {
        continue;
      }

      const roles = Array.isArray(item.roles) ? item.roles : [];

      if (!roleAssignments.has(sid)) {
        roleAssignments.set(sid, new Set());
      }

      for (const role of roles) {
        roleAssignments.get(sid).add(role);
        console.log(`[ROLE_MANUAL_SELECTED] Service ${sid}: ${role}`);
      }
    }

    // Then, auto-assign default roles for services with enable_role_selection=false
    for (const sid of validServiceIds) {
      const config = serviceConfigs.get(sid);

      if (!config) {
        console.log(`[SERVICE_SELECTED] Service ${sid}: No configuration found, skipping role assignment`);
        continue;
      }

      if (!config.enable_role_selection && config.default_role) {
        if (!roleAssignments.has(sid)) {
          roleAssignments.set(sid, new Set());
        }

        roleAssignments.get(sid).add(config.default_role);
        console.log(`[ROLE_AUTO_ASSIGNED] Service ${sid} (${config.name}): ${config.default_role} (auto)`);
      } else if (config.enable_role_selection) {
        console.log(`[SERVICE_SELECTED] Service ${sid} (${config.name}): Role selection enabled`);
      }
    }

    // Tier-automated services: instance selection drives RBAC role (overrides manual picks)
    await applyTierRolesToAssignments(client, roleAssignments, validServiceIds, selectedInstances);

    // Insert all role assignments into database
    for (const [sid, rolesSet] of roleAssignments.entries()) {
      for (const role of rolesSet) {
        await client.query(
          `
          INSERT INTO request_service_roles(
            request_id,
            service_id,
            azure_role
          )
          VALUES($1, $2, $3)
          ON CONFLICT (request_id, service_id, azure_role)
          DO NOTHING
          `,
          [requestId, sid, role]
        );
      }
    }



    await adminAccessRequestService.linkAdminAccessRequestsToRequest({
      customerEmail,
      requestId,
      client
    });

    await client.query(
      'COMMIT'
    );

    try {
      await adminAccessRequestService.fulfillLinkedApprovedAccessRequests({
        customerEmail,
        requestId
      });
    } catch (fulfillmentError) {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          service: 'request-service',
          level: 'error',
          event: 'approved_access_fulfillment_failed',
          requestId,
          message: fulfillmentError?.message
        })
      );
    }



    return {

      success:
      true,

      requestId,

      estimatedPrice

    };



  }

  catch(error){

    await client.query(
      'ROLLBACK'
    );

    throw error;

  }

  finally {

    client.release();

  }

}



async function getAllRequests(){

const result =
await db.query(
`
SELECT *
FROM requests
ORDER BY created_at DESC
`
);

return result.rows;

}



async function getRequestById(
requestId
){

const request =
await db.query(
`
SELECT *
FROM requests
WHERE id=$1
`,
[
requestId
]
);



if(
!request.rows.length
){

return null;

}



const services =
await db.query(
`
SELECT

s.id,

s.name,

rsr.azure_role

FROM request_services rs

LEFT JOIN services s

ON s.id=rs.service_id

LEFT JOIN request_service_roles rsr

ON rsr.service_id=s.id

AND rsr.request_id=rs.request_id

WHERE rs.request_id=$1
`,
[
requestId
]
);



const instances =
await db.query(
`
SELECT
  rsi.service_id,
  rsi.instance_option,
  s.name AS service_name
FROM request_service_instances rsi
LEFT JOIN services s ON s.id = rsi.service_id
WHERE rsi.request_id = $1
`,
[
requestId
]
);

return{

...request.rows[0],

services:
services.rows,

instances:
instances.rows

};

}



module.exports={

createRequest,

getAllRequests,

getRequestById

};

