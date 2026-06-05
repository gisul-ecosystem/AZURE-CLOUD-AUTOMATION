const db = require('../db/postgres');

const getAllCategories = async () => {
  const query = `
    SELECT
      id,
      name
    FROM service_categories
    ORDER BY name
  `;

  const result = await db.query(query);

  return result.rows;
};

module.exports = {
  getAllCategories
};
