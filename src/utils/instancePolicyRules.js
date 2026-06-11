const { normalizeVmSize } = require('./vmSize');

const BUILT_IN_POLICY_DEFINITIONS = {
  allowedVmSkus: '/providers/Microsoft.Authorization/policyDefinitions/cccc23c7-8427-4f53-ad12-b6a63eb452b3',
  allowedStorageSkus:
    '/providers/Microsoft.Authorization/policyDefinitions/7433c107-6db4-4ad1-b57a-a76dce0154a1'
};

const CUSTOM_POLICY_KEYS = {
  appServicePlanSku: 'ca-allowed-app-service-plan-sku',
  sqlDatabaseSku: 'ca-allowed-sql-database-sku',
  serviceBusSku: 'ca-allowed-service-bus-sku',
  keyVaultSku: 'ca-allowed-key-vault-sku',
  cosmosDbMode: 'ca-allowed-cosmos-db-mode',
  cdnSku: 'ca-allowed-cdn-sku',
  loadBalancerSku: 'ca-allowed-load-balancer-sku',
  appGatewaySku: 'ca-allowed-app-gateway-sku',
  searchSku: 'ca-allowed-search-sku',
  cognitiveServicesSku: 'ca-allowed-cognitive-services-sku',
  botServiceSku: 'ca-allowed-bot-service-sku',
  logicAppMode: 'ca-allowed-logic-app-mode'
};

const normalizeServiceName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^azure\s+/, '')
    .replace(/\(.*?\)/g, '')
    .trim();

const extractSkuToken = (instanceOption, fallback = 'B1') => {
  const raw = String(instanceOption || '').trim();
  if (!raw) {
    return fallback;
  }

  const compact = raw.replace(/^(basic|standard|premium|free)\s+/i, '').trim();
  const token = compact.split(/\s+/)[0] || fallback;
  return token.toUpperCase() === token && token.length <= 4 ? token : token;
};

const mapAppServiceSku = (instanceOption) => {
  const token = extractSkuToken(instanceOption, 'B1');
  if (/^f\d/i.test(token)) {
    return token.toUpperCase();
  }
  if (/^b\d/i.test(token)) {
    return token.toUpperCase();
  }
  if (/^s\d/i.test(token)) {
    return token.toUpperCase();
  }
  if (/^p\d/i.test(token)) {
    return token.toUpperCase();
  }

  if (/consumption/i.test(instanceOption)) {
    return 'Y1';
  }
  if (/premium/i.test(instanceOption)) {
    return 'P1v3';
  }
  if (/dedicated/i.test(instanceOption)) {
    return 'S1';
  }

  return token;
};

const mapSqlSku = (instanceOption) => {
  const raw = String(instanceOption || '').trim();
  if (!raw) {
    return 'Basic';
  }

  if (/^p\d/i.test(raw)) {
    return raw.toUpperCase();
  }
  if (/^s\d/i.test(raw)) {
    return raw.toUpperCase();
  }
  if (/basic/i.test(raw)) {
    return 'Basic';
  }

  return raw;
};

const mapStorageSku = (instanceOption) => {
  const raw = String(instanceOption || '').trim().toLowerCase();

  if (/premium|gen2 premium/i.test(raw)) {
    return 'Premium_LRS';
  }

  return 'Standard_LRS';
};

const mapServiceBusSku = (instanceOption) => {
  const raw = String(instanceOption || '').trim().toLowerCase();

  if (/premium/i.test(raw)) {
    return 'Premium';
  }
  if (/standard/i.test(raw)) {
    return 'Standard';
  }

  return 'Basic';
};

const mapKeyVaultSku = (instanceOption) => {
  const raw = String(instanceOption || '').trim().toLowerCase();
  return /premium/i.test(raw) ? 'premium' : 'standard';
};

const mapCosmosMode = (instanceOption) => {
  const raw = String(instanceOption || '').trim().toLowerCase();
  return /serverless/i.test(raw) ? 'Serverless' : 'Standard';
};

const mapCdnSku = (instanceOption) => {
  const raw = String(instanceOption || '').trim().toLowerCase();

  if (/akamai/i.test(raw)) {
    return 'Standard_Akamai';
  }
  if (/verizon|premium/i.test(raw)) {
    return 'Premium_Verizon';
  }

  return 'Standard_Microsoft';
};

const mapLoadBalancerSku = (instanceOption) => {
  const raw = String(instanceOption || '').trim().toLowerCase();
  return /standard/i.test(raw) ? 'Standard' : 'Basic';
};

const mapAppGatewaySku = (instanceOption) => {
  const raw = String(instanceOption || '').trim().toLowerCase();
  return /waf/i.test(raw) ? 'WAF_v2' : 'Standard_v2';
};

const mapSearchSku = (instanceOption) => {
  const raw = String(instanceOption || '').trim().toLowerCase();

  if (/s2/i.test(raw)) {
    return 'standard2';
  }
  if (/s1|standard/i.test(raw)) {
    return 'standard';
  }

  return 'basic';
};

const mapCognitiveServicesSku = (instanceOption) => {
  const raw = String(instanceOption || '').trim().toLowerCase();
  return /free/i.test(raw) ? 'F0' : 'S0';
};

const mapBotServiceSku = (instanceOption) => {
  const raw = String(instanceOption || '').trim().toLowerCase();
  return /standard/i.test(raw) ? 'S1' : 'F0';
};

const mapLogicAppMode = (instanceOption) => {
  const raw = String(instanceOption || '').trim().toLowerCase();
  return /standard/i.test(raw) ? 'Standard' : 'Consumption';
};

const mapLogicAppPlanSku = (instanceOption) => {
  const raw = String(instanceOption || '').trim().toLowerCase();

  if (/standard/i.test(raw)) {
    return 'WS1';
  }

  return null;
};

const mapAksNodeVmSize = (instanceOption) => {
  const raw = String(instanceOption || '').trim().toLowerCase();

  if (/production/i.test(raw)) {
    return normalizeVmSize('D4s_v5');
  }
  if (/test/i.test(raw)) {
    return normalizeVmSize('D2s_v5');
  }

  return normalizeVmSize('B2s');
};

const buildSkuListParameter = (allowedSkus) => ({
  listOfAllowedSKUs: {
    value: Array.from(new Set(allowedSkus.filter(Boolean)))
  }
});

const INSTANCE_POLICY_RULES = [
  {
    policyType: 'allowed_vm_sku',
    pattern: /virtual machine/,
    policyDefinitionId: BUILT_IN_POLICY_DEFINITIONS.allowedVmSkus,
    mergeAssignments: true,
    resolveAllowedSkus: (instanceOption) => [normalizeVmSize(instanceOption)],
    buildParameters: (instanceOption, allowedSkus) => ({
      displayNameSuffix: `Allowed VM SKU ${allowedSkus.join(', ')}`,
      parameters: buildSkuListParameter(allowedSkus)
    })
  },
  {
    policyType: 'allowed_aks_node_vm_sku',
    pattern: /kubernetes/,
    policyDefinitionId: BUILT_IN_POLICY_DEFINITIONS.allowedVmSkus,
    mergeAssignments: true,
    resolveAllowedSkus: (instanceOption) => [mapAksNodeVmSize(instanceOption)],
    buildParameters: (instanceOption, allowedSkus) => ({
      displayNameSuffix: `Allowed AKS node VM SKU ${allowedSkus.join(', ')}`,
      parameters: buildSkuListParameter(allowedSkus)
    })
  },
  {
    policyType: 'allowed_app_service_plan_sku',
    pattern: /app service|functions/,
    customPolicyKey: CUSTOM_POLICY_KEYS.appServicePlanSku,
    resolveAllowedSkus: (instanceOption) => [mapAppServiceSku(instanceOption)],
    buildParameters: (instanceOption, allowedSkus) => ({
      displayNameSuffix: `Allowed App Service plan SKU ${allowedSkus.join(', ')}`,
      parameters: buildSkuListParameter(allowedSkus)
    })
  },
  {
    policyType: 'allowed_storage_account_sku',
    pattern: /blob storage|data lake storage/,
    policyDefinitionId: BUILT_IN_POLICY_DEFINITIONS.allowedStorageSkus,
    resolveAllowedSkus: (instanceOption) => [mapStorageSku(instanceOption)],
    buildParameters: (instanceOption, allowedSkus) => ({
      displayNameSuffix: `Allowed storage account SKU ${allowedSkus.join(', ')}`,
      parameters: buildSkuListParameter(allowedSkus)
    })
  },
  {
    policyType: 'allowed_sql_database_sku',
    pattern: /sql database/,
    customPolicyKey: CUSTOM_POLICY_KEYS.sqlDatabaseSku,
    resolveAllowedSkus: (instanceOption) => [mapSqlSku(instanceOption)],
    buildParameters: (instanceOption, allowedSkus) => ({
      displayNameSuffix: `Allowed SQL database SKU ${allowedSkus.join(', ')}`,
      parameters: buildSkuListParameter(allowedSkus)
    })
  },
  {
    policyType: 'allowed_service_bus_sku',
    pattern: /service bus/,
    customPolicyKey: CUSTOM_POLICY_KEYS.serviceBusSku,
    resolveAllowedSkus: (instanceOption) => [mapServiceBusSku(instanceOption)],
    buildParameters: (instanceOption, allowedSkus) => ({
      displayNameSuffix: `Allowed Service Bus SKU ${allowedSkus.join(', ')}`,
      parameters: buildSkuListParameter(allowedSkus)
    })
  },
  {
    policyType: 'allowed_key_vault_sku',
    pattern: /key vault/,
    customPolicyKey: CUSTOM_POLICY_KEYS.keyVaultSku,
    resolveAllowedSkus: (instanceOption) => [mapKeyVaultSku(instanceOption)],
    buildParameters: (instanceOption, allowedSkus) => ({
      displayNameSuffix: `Allowed Key Vault SKU ${allowedSkus.join(', ')}`,
      parameters: {
        listOfAllowedSKUs: {
          value: Array.from(new Set(allowedSkus.filter(Boolean)))
        }
      }
    })
  },
  {
    policyType: 'allowed_cosmos_db_mode',
    pattern: /cosmos\s*db/,
    customPolicyKey: CUSTOM_POLICY_KEYS.cosmosDbMode,
    mergeAssignments: true,
    allowedParameterName: 'listOfAllowedCosmosModes',
    resolveAllowedSkus: (instanceOption) => [mapCosmosMode(instanceOption)],
    buildParameters: (instanceOption, allowedSkus) => ({
      displayNameSuffix: `Allowed Cosmos DB modes ${allowedSkus.join(', ')}`,
      parameters: {
        listOfAllowedCosmosModes: {
          value: Array.from(new Set(allowedSkus.filter(Boolean)))
        }
      }
    })
  },
  {
    policyType: 'allowed_cdn_sku',
    pattern: /\bcdn\b/,
    customPolicyKey: CUSTOM_POLICY_KEYS.cdnSku,
    resolveAllowedSkus: (instanceOption) => [mapCdnSku(instanceOption)],
    buildParameters: (instanceOption, allowedSkus) => ({
      displayNameSuffix: `Allowed CDN SKUs ${allowedSkus.join(', ')}`,
      parameters: buildSkuListParameter(allowedSkus)
    })
  },
  {
    policyType: 'allowed_load_balancer_sku',
    pattern: /load balancer/,
    customPolicyKey: CUSTOM_POLICY_KEYS.loadBalancerSku,
    resolveAllowedSkus: (instanceOption) => [mapLoadBalancerSku(instanceOption)],
    buildParameters: (instanceOption, allowedSkus) => ({
      displayNameSuffix: `Allowed load balancer SKUs ${allowedSkus.join(', ')}`,
      parameters: buildSkuListParameter(allowedSkus)
    })
  },
  {
    policyType: 'allowed_app_gateway_sku',
    pattern: /application gateway/,
    customPolicyKey: CUSTOM_POLICY_KEYS.appGatewaySku,
    resolveAllowedSkus: (instanceOption) => [mapAppGatewaySku(instanceOption)],
    buildParameters: (instanceOption, allowedSkus) => ({
      displayNameSuffix: `Allowed application gateway SKUs ${allowedSkus.join(', ')}`,
      parameters: buildSkuListParameter(allowedSkus)
    })
  },
  {
    policyType: 'allowed_search_sku',
    pattern: /ai search/,
    customPolicyKey: CUSTOM_POLICY_KEYS.searchSku,
    resolveAllowedSkus: (instanceOption) => [mapSearchSku(instanceOption)],
    buildParameters: (instanceOption, allowedSkus) => ({
      displayNameSuffix: `Allowed search SKUs ${allowedSkus.join(', ')}`,
      parameters: buildSkuListParameter(allowedSkus)
    })
  },
  {
    policyType: 'allowed_cognitive_services_sku',
    pattern: /ai vision|ai language|ai speech|document intelligence/,
    customPolicyKey: CUSTOM_POLICY_KEYS.cognitiveServicesSku,
    resolveAllowedSkus: (instanceOption) => [mapCognitiveServicesSku(instanceOption)],
    buildParameters: (instanceOption, allowedSkus) => ({
      displayNameSuffix: `Allowed cognitive services SKUs ${allowedSkus.join(', ')}`,
      parameters: buildSkuListParameter(allowedSkus)
    })
  },
  {
    policyType: 'allowed_bot_service_sku',
    pattern: /bot service/,
    customPolicyKey: CUSTOM_POLICY_KEYS.botServiceSku,
    resolveAllowedSkus: (instanceOption) => [mapBotServiceSku(instanceOption)],
    buildParameters: (instanceOption, allowedSkus) => ({
      displayNameSuffix: `Allowed bot service SKUs ${allowedSkus.join(', ')}`,
      parameters: buildSkuListParameter(allowedSkus)
    })
  },
  {
    policyType: 'allowed_logic_app_mode',
    pattern: /logic\s*apps?/,
    customPolicyKey: CUSTOM_POLICY_KEYS.logicAppMode,
    mergeAssignments: true,
    allowedParameterName: 'listOfAllowedLogicAppModes',
    resolveAllowedSkus: (instanceOption) => [mapLogicAppMode(instanceOption)],
    buildParameters: (instanceOption, allowedSkus) => ({
      displayNameSuffix: `Allowed Logic Apps modes ${allowedSkus.join(', ')}`,
      parameters: {
        listOfAllowedLogicAppModes: {
          value: Array.from(new Set(allowedSkus.filter(Boolean)))
        }
      }
    })
  }
];

const findInstancePolicyRule = (serviceName) => {
  const normalizedName = normalizeServiceName(serviceName);
  return INSTANCE_POLICY_RULES.find((rule) => rule.pattern.test(normalizedName)) || null;
};

module.exports = {
  BUILT_IN_POLICY_DEFINITIONS,
  CUSTOM_POLICY_KEYS,
  INSTANCE_POLICY_RULES,
  normalizeServiceName,
  findInstancePolicyRule,
  mapAppServiceSku,
  mapSqlSku,
  mapStorageSku,
  mapServiceBusSku,
  mapKeyVaultSku,
  mapCosmosMode,
  mapCdnSku,
  mapLoadBalancerSku,
  mapAppGatewaySku,
  mapSearchSku,
  mapCognitiveServicesSku,
  mapBotServiceSku,
  mapLogicAppMode,
  mapLogicAppPlanSku,
  mapAksNodeVmSize
};
