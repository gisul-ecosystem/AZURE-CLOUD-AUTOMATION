const SERVICE_PRICING_MAP = {
  'virtual machine': 'Virtual Machines',
  'virtual machines': 'Virtual Machines',
  vm: 'Virtual Machines',
  'azure virtual machine': 'Virtual Machines',
  storage: 'Storage',
  sql: 'SQL Database',
  'sql database': 'SQL Database',
  'azure sql': 'SQL Database',
  'azure sql database': 'SQL Database'
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

  return SERVICE_PRICING_MAP[normalizedKey] || candidate.trim();
};

module.exports = {
  SERVICE_PRICING_MAP,
  getAzureServiceName,
  normalizeServiceKey
};
