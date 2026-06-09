
const db = require('../db/postgres');
const pricingService = require('./pricingService');

async function createRequest({
  customerEmail,
  accountCount,
  location,
  serviceIds,
  selectedRoles,
  startDate,
  endDate,
  enableDailyUsage,
  dailyLimitMinutes
}) {

  const client = await db.connect();

  try {

    await client.query('BEGIN');

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

          client

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

          daily_limit_minutes

        )

        VALUES(

          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8

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

          enableDailyUsage === true && dailyLimitMinutes ? Number(dailyLimitMinutes) : null

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
    // Save Selected Roles
    // ==========================

    for (
      const item
      of (
        selectedRoles
        ||
        []
      )
    ) {

      const sid =
        Number(
          item.serviceId
        );

      if (
        !validServiceIds
          .includes(
            sid
          )
      ) {
        continue;
      }

      const roles =
        Array.isArray(
          item.roles
        )
          ? item.roles
          : [];



      for (
        const role
        of roles
      ) {

        await client.query(
          `
          INSERT INTO request_service_roles(

            request_id,

            service_id,

            azure_role

          )

          VALUES(

            $1,

            $2,

            $3

          )

          ON CONFLICT
          (
            request_id,
            service_id,
            azure_role
          )

          DO NOTHING
          `,
          [

            requestId,

            sid,

            role

          ]
        );

      }

    }



    await client.query(
      'COMMIT'
    );



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



return{

...request.rows[0],

services:
services.rows

};

}



module.exports={

createRequest,

getAllRequests,

getRequestById

};

