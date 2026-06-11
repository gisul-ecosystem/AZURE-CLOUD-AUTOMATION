const db = require('../db/postgres');
const { TIER_ROLE_FALLBACKS, findTierRoleFallbacks } = require('../config/tierRoleMappings');

const normalizeInstanceOption = (value) => String(value || '').trim();

const enrichMappingsWithFallbacks = async (client, mappings) => {
  const servicesResult = await client.query(
    `
      SELECT id, name
      FROM services
      WHERE active = true
    `
  );

  const enriched = [...mappings];

  for (const service of servicesResult.rows) {
    const serviceId = Number(service.id);
    const fallbacks = findTierRoleFallbacks(service.name);

    if (fallbacks.length === 0) {
      continue;
    }

    const existingOptions = new Set(
      enriched
        .filter((row) => Number(row.serviceId) === serviceId)
        .map((row) => String(row.instanceOption || '').trim().toLowerCase())
    );

    for (const fallback of fallbacks) {
      const optionKey = fallback.instanceOption.toLowerCase();
      if (existingOptions.has(optionKey)) {
        continue;
      }

      enriched.push({
        serviceId,
        serviceName: service.name,
        instanceOption: fallback.instanceOption,
        azureRole: fallback.azureRole,
        tierAutomated: true
      });
    }
  }

  return enriched;
};

const loadInstanceRoleMappings = async (client = db) => {
  let rows = [];

  try {
    const result = await client.query(
      `
        SELECT
          sirm.service_id,
          s.name AS service_name,
          sirm.instance_option,
          sirm.azure_role,
          sirm.tier_automated
        FROM service_instance_role_mapping sirm
        INNER JOIN services s ON s.id = sirm.service_id
        ORDER BY sirm.service_id, sirm.instance_option
      `
    );

    rows = result.rows.map((row) => ({
      serviceId: Number(row.service_id),
      serviceName: row.service_name,
      instanceOption: row.instance_option,
      azureRole: row.azure_role,
      tierAutomated: Boolean(row.tier_automated)
    }));
  } catch (error) {
    if (error?.code !== '42P01') {
      throw error;
    }
  }

  return enrichMappingsWithFallbacks(client, rows);
};

const buildMappingIndex = (rows) => {
  const byServiceId = new Map();

  for (const row of rows) {
    const serviceId = Number(row.serviceId);
    const instanceOption = normalizeInstanceOption(row.instanceOption);

    if (!byServiceId.has(serviceId)) {
      byServiceId.set(serviceId, new Map());
    }

    byServiceId.get(serviceId).set(instanceOption.toLowerCase(), row);
  }

  return byServiceId;
};

const resolveRoleForInstance = ({ serviceId, serviceName, instanceOption, mappingIndex }) => {
  const normalizedOption = normalizeInstanceOption(instanceOption).toLowerCase();

  if (!normalizedOption) {
    return null;
  }

  const serviceMappings = mappingIndex?.get(Number(serviceId));
  const mapped = serviceMappings?.get(normalizedOption);

  if (mapped) {
    return mapped;
  }

  const fallback = findTierRoleFallbacks(serviceName).find(
    (entry) => entry.instanceOption.toLowerCase() === normalizedOption
  );

  if (!fallback) {
    return null;
  }

  return {
    serviceId: Number(serviceId),
    serviceName,
    instanceOption: fallback.instanceOption,
    azureRole: fallback.azureRole,
    tierAutomated: true
  };
};

const resolveTierRoles = async (client, serviceIds, selectedInstances = []) => {
  const dbMappings = await loadInstanceRoleMappings(client);
  const mappingIndex = buildMappingIndex(dbMappings);

  const serviceNamesById = new Map();
  if (serviceIds.length > 0) {
    const servicesResult = await client.query(
      `
        SELECT id, name
        FROM services
        WHERE id = ANY($1::int[])
      `,
      [serviceIds]
    );

    for (const row of servicesResult.rows) {
      serviceNamesById.set(Number(row.id), row.name);
    }
  }

  const resolved = [];

  for (const item of selectedInstances || []) {
    const serviceId = Number(item?.serviceId ?? item?.service_id);
    const instanceOption = normalizeInstanceOption(item?.instanceOption ?? item?.instance_option);

    if (!Number.isInteger(serviceId) || serviceId <= 0 || !instanceOption) {
      continue;
    }

    const mapping = resolveRoleForInstance({
      serviceId,
      serviceName: serviceNamesById.get(serviceId),
      instanceOption,
      mappingIndex
    });

    if (mapping?.tierAutomated && mapping.azureRole) {
      resolved.push({
        serviceId,
        instanceOption,
        azureRole: mapping.azureRole,
        tierAutomated: true
      });
    }
  }

  return resolved;
};

const applyTierRolesToAssignments = async (client, roleAssignments, validServiceIds, selectedInstances) => {
  const tierRoles = await resolveTierRoles(client, validServiceIds, selectedInstances);

  for (const tierRole of tierRoles) {
    roleAssignments.set(tierRole.serviceId, new Set([tierRole.azureRole]));
    console.log(
      `[TIER_ROLE_AUTO_ASSIGNED] Service ${tierRole.serviceId} (${tierRole.instanceOption}): ${tierRole.azureRole}`
    );
  }

  return tierRoles;
};

module.exports = {
  TIER_ROLE_FALLBACKS,
  loadInstanceRoleMappings,
  buildMappingIndex,
  resolveRoleForInstance,
  resolveTierRoles,
  applyTierRolesToAssignments,
  findTierRoleFallbacks
};
