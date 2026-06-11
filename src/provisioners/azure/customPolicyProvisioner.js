const { PolicyClient } = require('@azure/arm-policy');
const { createAzureCredential, validateAzureEnv } = require('../../config/azure');
const { CUSTOM_POLICY_KEYS } = require('../../utils/instancePolicyRules');

const customPolicyCache = new Map();

const logEvent = (event, details = {}) => {
  console.log(
    JSON.stringify({
      event,
      service: 'azure-custom-policy-provisioner',
      timestamp: new Date().toISOString(),
      ...details
    })
  );
};

const CUSTOM_POLICY_DEFINITIONS = {
  [CUSTOM_POLICY_KEYS.appServicePlanSku]: {
    displayName: 'Cloud Automation - Allowed App Service plan SKUs',
    description: 'Restrict App Service plan SKUs that can be deployed in customer resource groups.',
    mode: 'All',
    parameters: {
      listOfAllowedSKUs: {
        type: 'Array',
        metadata: {
          displayName: 'Allowed SKUs',
          description: 'Allowed App Service plan SKU names.'
        }
      }
    },
    policyRule: {
      if: {
        allOf: [
          {
            field: 'type',
            equals: 'Microsoft.Web/serverfarms'
          },
          {
            not: {
              field: 'Microsoft.Web/serverfarms/sku.name',
              in: "[parameters('listOfAllowedSKUs')]"
            }
          }
        ]
      },
      then: {
        effect: 'deny'
      }
    }
  },
  [CUSTOM_POLICY_KEYS.sqlDatabaseSku]: {
    displayName: 'Cloud Automation - Allowed SQL database SKUs',
    description: 'Restrict SQL database SKUs that can be deployed in customer resource groups.',
    mode: 'All',
    parameters: {
      listOfAllowedSKUs: {
        type: 'Array',
        metadata: {
          displayName: 'Allowed SKUs',
          description: 'Allowed SQL database SKU names.'
        }
      }
    },
    policyRule: {
      if: {
        allOf: [
          {
            field: 'type',
            equals: 'Microsoft.Sql/servers/databases'
          },
          {
            not: {
              anyOf: [
                {
                  field: 'Microsoft.Sql/servers/databases/sku.name',
                  in: "[parameters('listOfAllowedSKUs')]"
                },
                {
                  field: 'Microsoft.Sql/servers/databases/requestedServiceObjectiveName',
                  in: "[parameters('listOfAllowedSKUs')]"
                }
              ]
            }
          }
        ]
      },
      then: {
        effect: 'deny'
      }
    }
  },
  [CUSTOM_POLICY_KEYS.serviceBusSku]: {
    displayName: 'Cloud Automation - Allowed Service Bus SKUs',
    description: 'Restrict Service Bus namespace SKUs that can be deployed in customer resource groups.',
    mode: 'All',
    parameters: {
      listOfAllowedSKUs: {
        type: 'Array',
        metadata: {
          displayName: 'Allowed SKUs',
          description: 'Allowed Service Bus namespace SKU names.'
        }
      }
    },
    policyRule: {
      if: {
        allOf: [
          {
            field: 'type',
            equals: 'Microsoft.ServiceBus/namespaces'
          },
          {
            not: {
              field: 'Microsoft.ServiceBus/namespaces/sku.name',
              in: "[parameters('listOfAllowedSKUs')]"
            }
          }
        ]
      },
      then: {
        effect: 'deny'
      }
    }
  },
  [CUSTOM_POLICY_KEYS.keyVaultSku]: {
    displayName: 'Cloud Automation - Allowed Key Vault SKUs',
    description: 'Restrict Key Vault SKUs that can be deployed in customer resource groups.',
    mode: 'All',
    parameters: {
      listOfAllowedSKUs: {
        type: 'Array',
        metadata: {
          displayName: 'Allowed SKUs',
          description: 'Allowed Key Vault SKU names.'
        }
      }
    },
    policyRule: {
      if: {
        allOf: [
          {
            field: 'type',
            equals: 'Microsoft.KeyVault/vaults'
          },
          {
            not: {
              field: 'Microsoft.KeyVault/vaults/sku.name',
              in: "[parameters('listOfAllowedSKUs')]"
            }
          }
        ]
      },
      then: {
        effect: 'deny'
      }
    }
  },
  [CUSTOM_POLICY_KEYS.cosmosDbMode]: {
    displayName: 'Cloud Automation - Allowed Cosmos DB capacity modes',
    description:
      'Restrict Cosmos DB account capacity modes (Serverless vs Standard provisioned) in customer resource groups.',
    mode: 'All',
    parameters: {
      listOfAllowedCosmosModes: {
        type: 'Array',
        metadata: {
          displayName: 'Allowed Cosmos DB modes',
          description: 'Allowed Cosmos DB capacity modes: Serverless or Standard.'
        }
      }
    },
    policyRule: {
      if: {
        allOf: [
          {
            field: 'type',
            equals: 'Microsoft.DocumentDB/databaseAccounts'
          },
          {
            anyOf: [
              {
                allOf: [
                  {
                    count: {
                      field: 'Microsoft.DocumentDB/databaseAccounts/capabilities[*].name',
                      where: {
                        field: 'Microsoft.DocumentDB/databaseAccounts/capabilities[*].name',
                        equals: 'EnableServerless'
                      },
                      greater: 0
                    }
                  },
                  {
                    not: {
                      value: 'Serverless',
                      in: "[parameters('listOfAllowedCosmosModes')]"
                    }
                  }
                ]
              },
              {
                allOf: [
                  {
                    count: {
                      field: 'Microsoft.DocumentDB/databaseAccounts/capabilities[*].name',
                      where: {
                        field: 'Microsoft.DocumentDB/databaseAccounts/capabilities[*].name',
                        equals: 'EnableServerless'
                      },
                      equals: 0
                    }
                  },
                  {
                    not: {
                      value: 'Standard',
                      in: "[parameters('listOfAllowedCosmosModes')]"
                    }
                  }
                ]
              }
            ]
          }
        ]
      },
      then: {
        effect: 'deny'
      }
    }
  },
  [CUSTOM_POLICY_KEYS.cdnSku]: {
    displayName: 'Cloud Automation - Allowed CDN profile SKUs',
    description: 'Restrict CDN profile SKUs that can be deployed in customer resource groups.',
    mode: 'All',
    parameters: {
      listOfAllowedSKUs: {
        type: 'Array',
        metadata: {
          displayName: 'Allowed SKUs',
          description: 'Allowed CDN profile SKU names.'
        }
      }
    },
    policyRule: {
      if: {
        allOf: [
          {
            field: 'type',
            equals: 'Microsoft.Cdn/profiles'
          },
          {
            not: {
              field: 'Microsoft.Cdn/profiles/sku.name',
              in: "[parameters('listOfAllowedSKUs')]"
            }
          }
        ]
      },
      then: {
        effect: 'deny'
      }
    }
  },
  [CUSTOM_POLICY_KEYS.loadBalancerSku]: {
    displayName: 'Cloud Automation - Allowed load balancer SKUs',
    description: 'Restrict load balancer SKUs that can be deployed in customer resource groups.',
    mode: 'All',
    parameters: {
      listOfAllowedSKUs: {
        type: 'Array',
        metadata: {
          displayName: 'Allowed SKUs',
          description: 'Allowed load balancer SKU names (Basic or Standard).'
        }
      }
    },
    policyRule: {
      if: {
        allOf: [
          {
            field: 'type',
            equals: 'Microsoft.Network/loadBalancers'
          },
          {
            not: {
              field: 'Microsoft.Network/loadBalancers/sku.name',
              in: "[parameters('listOfAllowedSKUs')]"
            }
          }
        ]
      },
      then: {
        effect: 'deny'
      }
    }
  },
  [CUSTOM_POLICY_KEYS.appGatewaySku]: {
    displayName: 'Cloud Automation - Allowed application gateway SKUs',
    description: 'Restrict application gateway SKUs that can be deployed in customer resource groups.',
    mode: 'All',
    parameters: {
      listOfAllowedSKUs: {
        type: 'Array',
        metadata: {
          displayName: 'Allowed SKUs',
          description: 'Allowed application gateway SKU names.'
        }
      }
    },
    policyRule: {
      if: {
        allOf: [
          {
            field: 'type',
            equals: 'Microsoft.Network/applicationGateways'
          },
          {
            not: {
              field: 'Microsoft.Network/applicationGateways/sku.name',
              in: "[parameters('listOfAllowedSKUs')]"
            }
          }
        ]
      },
      then: {
        effect: 'deny'
      }
    }
  },
  [CUSTOM_POLICY_KEYS.searchSku]: {
    displayName: 'Cloud Automation - Allowed AI Search SKUs',
    description: 'Restrict Azure AI Search service SKUs that can be deployed in customer resource groups.',
    mode: 'All',
    parameters: {
      listOfAllowedSKUs: {
        type: 'Array',
        metadata: {
          displayName: 'Allowed SKUs',
          description: 'Allowed search service SKU names.'
        }
      }
    },
    policyRule: {
      if: {
        allOf: [
          {
            field: 'type',
            equals: 'Microsoft.Search/searchServices'
          },
          {
            not: {
              field: 'Microsoft.Search/searchServices/sku.name',
              in: "[parameters('listOfAllowedSKUs')]"
            }
          }
        ]
      },
      then: {
        effect: 'deny'
      }
    }
  },
  [CUSTOM_POLICY_KEYS.cognitiveServicesSku]: {
    displayName: 'Cloud Automation - Allowed Cognitive Services SKUs',
    description: 'Restrict Cognitive Services account SKUs that can be deployed in customer resource groups.',
    mode: 'All',
    parameters: {
      listOfAllowedSKUs: {
        type: 'Array',
        metadata: {
          displayName: 'Allowed SKUs',
          description: 'Allowed Cognitive Services SKU names (F0, S0).'
        }
      }
    },
    policyRule: {
      if: {
        allOf: [
          {
            field: 'type',
            equals: 'Microsoft.CognitiveServices/accounts'
          },
          {
            not: {
              field: 'Microsoft.CognitiveServices/accounts/sku.name',
              in: "[parameters('listOfAllowedSKUs')]"
            }
          }
        ]
      },
      then: {
        effect: 'deny'
      }
    }
  },
  [CUSTOM_POLICY_KEYS.botServiceSku]: {
    displayName: 'Cloud Automation - Allowed Bot Service SKUs',
    description: 'Restrict Bot Service SKUs that can be deployed in customer resource groups.',
    mode: 'All',
    parameters: {
      listOfAllowedSKUs: {
        type: 'Array',
        metadata: {
          displayName: 'Allowed SKUs',
          description: 'Allowed Bot Service SKU names (F0, S1).'
        }
      }
    },
    policyRule: {
      if: {
        allOf: [
          {
            field: 'type',
            equals: 'Microsoft.BotService/botServices'
          },
          {
            not: {
              field: 'Microsoft.BotService/botServices/sku.name',
              in: "[parameters('listOfAllowedSKUs')]"
            }
          }
        ]
      },
      then: {
        effect: 'deny'
      }
    }
  },
  [CUSTOM_POLICY_KEYS.logicAppMode]: {
    displayName: 'Cloud Automation - Allowed Logic Apps hosting modes',
    description:
      'Restrict Logic Apps hosting (Consumption vs Standard workflow plans) in customer resource groups.',
    mode: 'All',
    parameters: {
      listOfAllowedLogicAppModes: {
        type: 'Array',
        metadata: {
          displayName: 'Allowed Logic Apps modes',
          description: 'Allowed Logic Apps modes: Consumption or Standard.'
        }
      }
    },
    policyRule: {
      if: {
        allOf: [
          {
            field: 'type',
            equals: 'Microsoft.Web/serverfarms'
          },
          {
            field: 'Microsoft.Web/serverfarms/sku.tier',
            equals: 'WorkflowStandard'
          },
          {
            not: {
              value: 'Standard',
              in: "[parameters('listOfAllowedLogicAppModes')]"
            }
          }
        ]
      },
      then: {
        effect: 'deny'
      }
    }
  }
};

const createPolicyClient = () => {
  const azureConfig = validateAzureEnv();
  const credential = createAzureCredential(azureConfig);

  return {
    policyClient: new PolicyClient(credential, azureConfig.subscriptionId),
    subscriptionId: azureConfig.subscriptionId
  };
};

const getCustomPolicyDefinitionId = (subscriptionId, policyKey) =>
  `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/policyDefinitions/${policyKey}`;

const buildPolicyDefinitionPayload = (definition) => ({
  displayName: definition.displayName,
  description: definition.description,
  policyType: 'Custom',
  mode: definition.mode,
  parameters: definition.parameters,
  policyRule: definition.policyRule
});

const ensureCustomPolicyDefinition = async (policyKey) => {
  if (customPolicyCache.has(policyKey)) {
    return customPolicyCache.get(policyKey);
  }

  const definition = CUSTOM_POLICY_DEFINITIONS[policyKey];
  if (!definition) {
    throw new Error(`Unknown custom policy key: ${policyKey}`);
  }

  const { policyClient, subscriptionId } = createPolicyClient();
  const definitionId = getCustomPolicyDefinitionId(subscriptionId, policyKey);

  try {
    const existing = await policyClient.policyDefinitions.get(policyKey);
    if (existing?.policyRule) {
      customPolicyCache.set(policyKey, definitionId);
      return definitionId;
    }

    logEvent('custom_policy_definition_repair_started', {
      policyKey,
      reason: 'missing_policy_rule'
    });
  } catch (error) {
    if (Number(error?.statusCode || error?.status) !== 404) {
      throw error;
    }
  }

  logEvent('custom_policy_definition_create_started', { policyKey });

  await policyClient.policyDefinitions.createOrUpdate(
    policyKey,
    buildPolicyDefinitionPayload(definition)
  );

  logEvent('custom_policy_definition_create_success', { policyKey, definitionId });

  customPolicyCache.set(policyKey, definitionId);
  return definitionId;
};

module.exports = {
  ensureCustomPolicyDefinition,
  getCustomPolicyDefinitionId
};
