const db = require('../db/postgres');
const pricingService = require('./pricingService');

async function createRequest({
  customerEmail,
  accountCount,
  location,
  expiryDate,
  serviceIds,
  provisionServiceIds,
  startDate,
  endDate
}) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // ------------------------------------------------
    // STEP 1 — Catalog IDs → Catalog service names
    // ------------------------------------------------

    const selectedCatalogIds =
      Array.isArray(serviceIds)
        ? serviceIds.map(Number).filter(Boolean)
        : [];

    if (!selectedCatalogIds.length) {
      throw new Error('No services selected');
    }

    const catalogResult = await client.query(
      `
      SELECT
        id,
        service_name
      FROM service_locations
      WHERE id = ANY($1)
      `,
      [selectedCatalogIds]
    );

    console.log(
      'CATALOG_ROWS',
      catalogResult.rows
    );

    if (!catalogResult.rows.length) {
      throw new Error('Selected catalog services not found');
    }

    // ------------------------------------------------
    // STEP 2 — Service names → services.id
    // ------------------------------------------------

    const catalogNames =
      catalogResult.rows
        .map((r) =>
          String(r.service_name || '')
            .trim()
            .toLowerCase()
        )
        .filter(Boolean);

    const serviceLookup =
      await client.query(
        `
        SELECT
          id,
          name
        FROM services
        WHERE LOWER(TRIM(name))
        = ANY($1)
        ORDER BY id
        `,
        [catalogNames]
      );

    const validServiceIds =
      [
        ...new Set(
          serviceLookup.rows.map(
            (r) => Number(r.id)
          )
        )
      ];

    console.log({
      catalogIds: selectedCatalogIds,
      catalogNames,
      resolvedServices: serviceLookup.rows,
      validServiceIds
    });

    if (!validServiceIds.length) {
      throw new Error(
        `No matching services found for: ${catalogNames.join(', ')}`
      );
    }

    // ------------------------------------------------
    // STEP 3 — Pricing
    // ------------------------------------------------

    const pricing =
      await pricingService.calculatePricing({
        accountCount,
        serviceIds: validServiceIds,
        location,
        startDate,
        endDate,
        client
      });

    const estimatedPrice =
      pricing.estimatedPrice ??
      pricing.totalPrice ??
      0;

    // ------------------------------------------------
    // STEP 4 — Create request
    // ------------------------------------------------

    const requestResult =
      await client.query(
        `
        INSERT INTO requests
        (
          customer_email,
          account_count,
          location,
          expiry_date,
          estimated_price,
          status
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6
        )
        RETURNING
        id,
        estimated_price
        `,
        [
          customerEmail,
          accountCount,
          location,
          expiryDate,
          estimatedPrice,
          'Pending'
        ]
      );

    const createdRequest =
      requestResult.rows[0];

    // ------------------------------------------------
    // STEP 5 — Insert request services
    // ------------------------------------------------

    for (const sid of validServiceIds) {

      const exists =
        await client.query(
          `
          SELECT id
          FROM services
          WHERE id=$1
          `,
          [sid]
        );

      if (!exists.rowCount) {
        console.log(
          'SKIP_INVALID_SERVICE',
          sid
        );
        continue;
      }

      console.log(
        'INSERT_SERVICE',
        createdRequest.id,
        sid
      );

      await client.query(
        `
        INSERT INTO request_services
        (
          request_id,
          service_id
        )
        VALUES
        (
          $1,
          $2
        )
        `,
        [
          createdRequest.id,
          sid
        ]
      );
    }

    await client.query('COMMIT');

    return {
      success: true,
      requestId: createdRequest.id,
      estimatedPrice:
        Number(
          createdRequest.estimated_price
        )
    };

  } catch (error) {

    await client.query('ROLLBACK');

    console.error(
      'REQUEST_CREATE_ERROR',
      error
    );

    throw error;

  } finally {

    client.release();

  }
}

async function getAllRequests() {

  const result =
    await db.query(
      `
      SELECT
        id,
        customer_email,
        account_count,
        location,
        expiry_date,
        estimated_price,
        status,
        created_at,
        expired,
        cleanup_completed
      FROM requests
      ORDER BY created_at DESC
      `
    );

  return result.rows;

}

async function getRequestById(
  requestId
) {

  const request =
    await db.query(
      `
      SELECT *
      FROM requests
      WHERE id=$1
      `,
      [requestId]
    );

  if (
    !request.rows.length
  ) {
    return null;
  }

  const services =
    await db.query(
      `
      SELECT
        s.id,
        s.name,
        s.price_per_user
      FROM request_services rs
      JOIN services s
      ON s.id=rs.service_id
      WHERE rs.request_id=$1
      `,
      [requestId]
    );

  return {
    ...request.rows[0],
    services: services.rows
  };

}

module.exports = {
  createRequest,
  getAllRequests,
  getRequestById
};