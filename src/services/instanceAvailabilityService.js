const db = require('../db/postgres');
const { filterVmInstancesForLocation } = require('./vmInstanceAvailabilityService');
const { enrichInstances } = require('./instanceEnrichmentService');
const { findInstancePolicyRule, normalizeServiceName } = require('../utils/instancePolicyRules');

const filterInstancesForLocation = async (location, instances, servicesById) => {
  const vmFiltered = await filterVmInstancesForLocation(location, instances, servicesById);

  return vmFiltered.filter((instance) => {
    const serviceId = Number(instance.serviceId ?? instance.service_id);
    const service = servicesById.get(serviceId);
    const rule = findInstancePolicyRule(service?.name);

    if (!rule || rule.policyType === 'allowed_vm_sku' || rule.policyType === 'allowed_aks_node_vm_sku') {
      return true;
    }

    const optionName = String(instance.option_name || '').trim();
    if (!optionName) {
      return false;
    }

    const allowedSkus = rule.resolveAllowedSkus(optionName);
    return allowedSkus.length > 0;
  });
};

const getAvailableInstancesForLocation = async (location, serviceIds) => {
  const resolvedServiceIds = Array.from(
    new Set(
      (Array.isArray(serviceIds) ? serviceIds : [])
        .map((serviceId) => Number(serviceId))
        .filter((serviceId) => Number.isInteger(serviceId) && serviceId > 0)
    )
  );

  if (resolvedServiceIds.length === 0) {
    return [];
  }

  const [instancesResult, servicesResult] = await Promise.all([
    db.query(
      `
        SELECT
          id,
          service_id,
          option_name,
          sort_order
        FROM service_instance_options
        WHERE service_id = ANY($1::bigint[])
        ORDER BY service_id, sort_order, option_name
      `,
      [resolvedServiceIds]
    ),
    db.query(
      `
        SELECT
          id,
          name,
          COALESCE(price_per_user, 0) AS price_per_user
        FROM services
        WHERE id = ANY($1::int[])
      `,
      [resolvedServiceIds]
    )
  ]);

  const servicesById = new Map(
    servicesResult.rows.map((row) => [
      Number(row.id),
      {
        id: Number(row.id),
        name: row.name,
        price_per_user: Number(row.price_per_user || 0)
      }
    ])
  );

  const instances = instancesResult.rows.map((row) => ({
    id: Number(row.id),
    serviceId: Number(row.service_id),
    option_name: row.option_name,
    sort_order: Number(row.sort_order)
  }));

  const normalizedLocation = String(location || '').trim().toLowerCase();
  if (!normalizedLocation) {
    return enrichInstances(instances, servicesById);
  }

  const filtered = await filterInstancesForLocation(normalizedLocation, instances, servicesById);

  return enrichInstances(filtered, servicesById, normalizedLocation);
};

const serviceSupportsInstances = (serviceName) => Boolean(findInstancePolicyRule(serviceName));

module.exports = {
  filterInstancesForLocation,
  getAvailableInstancesForLocation,
  serviceSupportsInstances,
  normalizeServiceName
};
