/**
 * Tier → RBAC role fallbacks used when service_instance_role_mapping rows
 * are missing (e.g. before migration runs). DB rows are the source of truth.
 */
const TIER_ROLE_FALLBACKS = [
  {
    servicePattern: /cosmos\s*db/i,
    mappings: [
      { instanceOption: 'Serverless', azureRole: 'Cosmos DB Account Reader Role' },
      { instanceOption: 'Provisioned Throughput', azureRole: 'Cosmos DB Operator' },
      { instanceOption: 'Autoscale', azureRole: 'Cosmos DB Operator' }
    ]
  },
  {
    servicePattern: /virtual network|vnet/i,
    mappings: [
      { instanceOption: 'Small VNet', azureRole: 'Network Reader' },
      { instanceOption: 'Medium VNet', azureRole: 'Network Contributor' },
      { instanceOption: 'Large VNet', azureRole: 'Network Contributor' }
    ]
  },
  {
    servicePattern: /\bcdn\b/i,
    mappings: [
      { instanceOption: 'Standard Microsoft', azureRole: 'CDN Endpoint Contributor' },
      { instanceOption: 'Standard Akamai', azureRole: 'CDN Endpoint Contributor' },
      { instanceOption: 'Premium Verizon', azureRole: 'CDN Endpoint Contributor' }
    ]
  },
  {
    servicePattern: /load balancer/i,
    mappings: [
      { instanceOption: 'Basic', azureRole: 'Network Reader' },
      { instanceOption: 'Standard', azureRole: 'Network Contributor' }
    ]
  },
  {
    servicePattern: /application gateway/i,
    mappings: [
      { instanceOption: 'Standard_v2', azureRole: 'Application Gateway Contributor' },
      { instanceOption: 'WAF_v2', azureRole: 'Application Gateway Contributor' }
    ]
  },
  {
    servicePattern: /expressroute/i,
    mappings: [
      { instanceOption: '50 Mbps', azureRole: 'Network Reader' },
      { instanceOption: '100 Mbps', azureRole: 'Network Reader' },
      { instanceOption: '500 Mbps', azureRole: 'Network Contributor' },
      { instanceOption: '1 Gbps', azureRole: 'Network Contributor' }
    ]
  },
  {
    servicePattern: /entra id|azure ad/i,
    mappings: [
      { instanceOption: 'Free', azureRole: 'Directory Readers' },
      { instanceOption: 'P1', azureRole: 'User Administrator' },
      { instanceOption: 'P2', azureRole: 'User Administrator' }
    ]
  },
  {
    servicePattern: /defender for cloud/i,
    mappings: [
      { instanceOption: 'Foundational CSPM', azureRole: 'Security Reader' },
      { instanceOption: 'Defender Servers', azureRole: 'Security Admin' },
      { instanceOption: 'Defender SQL', azureRole: 'Security Admin' }
    ]
  },
  {
    servicePattern: /event grid/i,
    mappings: [
      { instanceOption: 'Basic', azureRole: 'EventGrid Contributor' },
      { instanceOption: 'Standard', azureRole: 'EventGrid Contributor' }
    ]
  },
  {
    servicePattern: /logic apps?/i,
    mappings: [
      { instanceOption: 'Consumption', azureRole: 'Logic App Contributor' },
      { instanceOption: 'Standard', azureRole: 'Logic App Operator' }
    ]
  },
  {
    servicePattern: /^azure monitor$/i,
    mappings: [
      { instanceOption: 'Basic Monitoring', azureRole: 'Monitoring Reader' },
      { instanceOption: 'Advanced Monitoring', azureRole: 'Monitoring Contributor' }
    ]
  },
  {
    servicePattern: /application insights/i,
    mappings: [
      { instanceOption: 'Basic', azureRole: 'Monitoring Reader' },
      { instanceOption: 'Enterprise', azureRole: 'Monitoring Contributor' }
    ]
  },
  {
    servicePattern: /azure devops/i,
    mappings: [
      { instanceOption: 'Stakeholder', azureRole: 'Contributor' },
      { instanceOption: 'Basic', azureRole: 'Project Administrator' },
      { instanceOption: 'Basic + Test Plans', azureRole: 'Project Administrator' }
    ]
  },
  {
    servicePattern: /openai service/i,
    mappings: [
      { instanceOption: 'Embeddings', azureRole: 'Cognitive Services User' },
      { instanceOption: 'GPT-4o', azureRole: 'Cognitive Services OpenAI Contributor' },
      { instanceOption: 'GPT-4.1', azureRole: 'Cognitive Services OpenAI Contributor' },
      { instanceOption: 'GPT-4 Turbo', azureRole: 'Cognitive Services OpenAI Contributor' }
    ]
  },
  {
    servicePattern: /ai foundry/i,
    mappings: [
      { instanceOption: 'Starter', azureRole: 'Azure AI Developer' },
      { instanceOption: 'Standard', azureRole: 'Azure AI Developer' },
      { instanceOption: 'Enterprise', azureRole: 'Azure AI Developer' }
    ]
  },
  {
    servicePattern: /ai search/i,
    mappings: [
      { instanceOption: 'Basic', azureRole: 'Search Index Data Contributor' },
      { instanceOption: 'Standard S1', azureRole: 'Search Service Contributor' },
      { instanceOption: 'Standard S2', azureRole: 'Search Service Contributor' }
    ]
  },
  {
    servicePattern: /machine learning/i,
    mappings: [
      { instanceOption: 'Basic Compute', azureRole: 'AzureML Compute Operator' },
      { instanceOption: 'CPU Cluster', azureRole: 'AzureML Data Scientist' },
      { instanceOption: 'GPU Cluster', azureRole: 'AzureML Data Scientist' }
    ]
  },
  {
    servicePattern: /ai vision/i,
    mappings: [
      { instanceOption: 'Free', azureRole: 'Cognitive Services User' },
      { instanceOption: 'Standard', azureRole: 'Cognitive Services Contributor' }
    ]
  },
  {
    servicePattern: /ai language/i,
    mappings: [
      { instanceOption: 'Free', azureRole: 'Cognitive Services User' },
      { instanceOption: 'Standard', azureRole: 'Cognitive Services Contributor' }
    ]
  },
  {
    servicePattern: /ai speech/i,
    mappings: [
      { instanceOption: 'Free', azureRole: 'Cognitive Services User' },
      { instanceOption: 'Standard', azureRole: 'Cognitive Services Contributor' }
    ]
  },
  {
    servicePattern: /document intelligence/i,
    mappings: [
      { instanceOption: 'Free', azureRole: 'Cognitive Services User' },
      { instanceOption: 'Standard', azureRole: 'Cognitive Services Contributor' }
    ]
  },
  {
    servicePattern: /bot service/i,
    mappings: [
      { instanceOption: 'Basic', azureRole: 'Contributor' },
      { instanceOption: 'Standard', azureRole: 'Contributor' }
    ]
  }
];

const findTierRoleFallbacks = (serviceName) => {
  const normalized = String(serviceName || '').trim();
  if (!normalized) {
    return [];
  }

  const entry = TIER_ROLE_FALLBACKS.find((item) => item.servicePattern.test(normalized));
  if (!entry) {
    return [];
  }

  return entry.mappings.map((mapping) => ({
    instanceOption: mapping.instanceOption,
    azureRole: mapping.azureRole,
    tierAutomated: true
  }));
};

module.exports = {
  TIER_ROLE_FALLBACKS,
  findTierRoleFallbacks
};
