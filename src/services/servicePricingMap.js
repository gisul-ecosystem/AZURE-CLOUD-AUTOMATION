const SERVICE_PRICING_MAP = {
  'virtual machine': 'Virtual Machines',
  'virtual machines': 'Virtual Machines',
  vm: 'Virtual Machines',
  'azure virtual machine': 'Virtual Machines',
  'azure virtual machines (vms)': 'Virtual Machines',
  storage: 'Storage',
  'azure blob storage': 'Storage',
  'azure data lake storage': 'Storage',
  sql: 'SQL Database',
  'sql database': 'SQL Database',
  'azure sql': 'SQL Database',
  'azure sql database': 'SQL Database',
  'azure app service': 'Azure App Service',
  'azure functions': 'Azure App Service',
  'azure key vault': 'Key Vault',
  'azure cosmos db': 'Azure Cosmos DB',
  'azure kubernetes service (aks)': 'Azure Kubernetes Service'
};

const normalizeServiceKey = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase().replace(/\s+/g, ' ');
};

const getAzureServiceName = (service) => {
  const candidate =
    typeof service === 'string'
      ? service
      : service?.name || service?.azure_role || service?.category || '';

  const normalizedKey = normalizeServiceKey(candidate);

  if (!normalizedKey) {
    return null;
  }

  if (SERVICE_PRICING_MAP[normalizedKey]) {
    return SERVICE_PRICING_MAP[normalizedKey];
  }

  for (const [key, azureName] of Object.entries(SERVICE_PRICING_MAP)) {
    if (normalizedKey.includes(key)) {
      return azureName;
    }
  }

  return candidate.trim();
};

module.exports = {
  SERVICE_PRICING_MAP,
  getAzureServiceName,
  normalizeServiceKey
};
