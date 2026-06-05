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

    const { estimatedPrice, totalPrice, services } = await pricingService.calculatePricing({
      accountCount,
      serviceIds,
      location,
      startDate,
      endDate,
      client
    });

    const insertRequestQuery = `
      INSERT INTO requests (customer_email, account_count, location, expiry_date, estimated_price, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, estimated_price
    `;

    const requestValues = [customerEmail, accountCount, location, expiryDate, estimatedPrice ?? totalPrice, 'Pending'];
    const requestResult = await client.query(insertRequestQuery, requestValues);
    const createdRequest = requestResult.rows[0];

    const requestServiceIds =
      Array.isArray(provisionServiceIds) && provisionServiceIds.length > 0
        ? provisionServiceIds
        : serviceIds;

    const insertRequestServiceQuery = `
      INSERT INTO request_services (request_id, service_id)
      VALUES ($1, $2)
    `;

    for (const serviceId of requestServiceIds) {
      await client.query(insertRequestServiceQuery, [createdRequest.id, serviceId]);
    }

    await client.query('COMMIT');

    return {
      requestId: createdRequest.id,
      estimatedPrice: Number(createdRequest.estimated_price)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getAllRequests() {
  const query = `
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
    ORDER BY created_at DESC, id DESC
  `;

  const result = await db.query(query);

  return result.rows.map((request) => ({
    ...request,
    estimated_price: Number(request.estimated_price)
  }));
}

async function getRequestById(requestId) {
  const requestQuery = `
    SELECT id, customer_email, account_count, location, expiry_date, estimated_price, status, created_at
    FROM requests
    WHERE id = $1
  `;

  const requestResult = await db.query(requestQuery, [requestId]);

  if (requestResult.rows.length === 0) {
    return null;
  }

  const servicesQuery = `
    SELECT s.id, s.name, s.price_per_user
    FROM request_services rs
    INNER JOIN services s ON s.id = rs.service_id
    WHERE rs.request_id = $1
    ORDER BY s.name ASC
  `;

  const servicesResult = await db.query(servicesQuery, [requestId]);
  const request = requestResult.rows[0];

  return {
    ...request,
    estimated_price: Number(request.estimated_price),
    services: servicesResult.rows.map((service) => ({
      ...service,
      price_per_user: Number(service.price_per_user)
    }))
  };
}

module.exports = {
  getAllRequests,
  getRequestById,
  createRequest
};
