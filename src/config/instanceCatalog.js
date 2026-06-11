const normalizeKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^azure\s+/, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const VM_GUIDES = {
  B1s: {
    summary: 'Entry-level burstable VM for light workloads.',
    description: 'Best for dev/test, small web servers, and low-traffic apps. CPU credits allow brief bursts above baseline.',
    vcpu: '1',
    ram: '1 GB',
    storage: 'Temp SSD',
    tier: 'Burstable'
  },
  B2s: {
    summary: 'Balanced burstable VM for everyday apps.',
    description: 'Good for small databases, APIs, and staging environments with moderate CPU bursts.',
    vcpu: '2',
    ram: '4 GB',
    storage: 'Temp SSD',
    tier: 'Burstable'
  },
  D2s_v5: {
    summary: 'General-purpose compute with balanced CPU and memory.',
    description: 'Ideal for production web apps, app servers, and mid-tier business workloads.',
    vcpu: '2',
    ram: '8 GB',
    storage: 'Temp SSD',
    tier: 'General purpose'
  },
  D4s_v5: {
    summary: 'Higher-capacity general-purpose VM.',
    description: 'Suitable for larger app tiers, batch processing, and multi-service workloads.',
    vcpu: '4',
    ram: '16 GB',
    storage: 'Temp SSD',
    tier: 'General purpose'
  },
  D8s_v5: {
    summary: 'High-performance general-purpose VM.',
    description: 'For demanding production apps, analytics workloads, and larger microservice pools.',
    vcpu: '8',
    ram: '32 GB',
    storage: 'Temp SSD',
    tier: 'General purpose'
  },
  E2s_v5: {
    summary: 'Memory-optimized VM for in-memory workloads.',
    description: 'Best for caches, in-memory databases, and memory-heavy middleware.',
    vcpu: '2',
    ram: '16 GB',
    storage: 'Temp SSD',
    tier: 'Memory optimized'
  },
  E4s_v5: {
    summary: 'Mid-tier memory-optimized VM.',
    description: 'For larger in-memory apps, SAP HANA dev/test, and high-memory analytics.',
    vcpu: '4',
    ram: '32 GB',
    storage: 'Temp SSD',
    tier: 'Memory optimized'
  },
  E8s_v5: {
    summary: 'Large memory-optimized VM.',
    description: 'For enterprise in-memory databases and large-scale analytics engines.',
    vcpu: '8',
    ram: '64 GB',
    storage: 'Temp SSD',
    tier: 'Memory optimized'
  }
};

const SERVICE_GUIDES = {
  'kubernetes service': {
    'Dev Cluster': {
      summary: 'Small AKS cluster for development.',
      description: 'Single or few B-series nodes. Low cost for experiments and CI smoke tests.',
      vcpu: '2 per node',
      ram: '4 GB per node',
      tier: 'Dev'
    },
    'Test Cluster': {
      summary: 'AKS cluster sized for integration testing.',
      description: 'D-series nodes with balanced CPU and memory for QA and staging pipelines.',
      vcpu: '2 per node',
      ram: '8 GB per node',
      tier: 'Test'
    },
    'Production Cluster': {
      summary: 'Production-grade AKS cluster.',
      description: 'D4s_v5 nodes for reliable production microservices with room to scale.',
      vcpu: '4 per node',
      ram: '16 GB per node',
      tier: 'Production'
    }
  },
  'app service': {
    'Free F1': {
      summary: 'Shared free tier for learning and prototypes.',
      description: '60 CPU minutes/day, no SLA. Apps may sleep when idle.',
      ram: '1 GB shared',
      tier: 'Free'
    },
    'Basic B1': {
      summary: 'Dedicated compute for small apps.',
      description: 'Manual scale only. Good for low-traffic internal tools.',
      vcpu: '1',
      ram: '1.75 GB',
      tier: 'Basic'
    },
    'Basic B2': {
      summary: 'More headroom for small production apps.',
      description: 'Twice the compute of B1. Suitable for APIs and internal portals.',
      vcpu: '2',
      ram: '3.5 GB',
      tier: 'Basic'
    },
    'Standard S1': {
      summary: 'Auto-scale ready app hosting.',
      description: 'Supports staging slots, auto-scale, and custom domains with SSL.',
      vcpu: '1',
      ram: '1.75 GB',
      tier: 'Standard'
    },
    'Premium P1v3': {
      summary: 'High-performance app hosting.',
      description: 'Premium v3 series with better CPU and memory for production APIs and web apps.',
      vcpu: '2',
      ram: '8 GB',
      tier: 'Premium v3'
    }
  },
  'functions': {
    'Consumption Plan': {
      summary: 'Pay-per-execution serverless hosting.',
      description: 'Scales automatically. Best for event-driven and sporadic workloads.',
      tier: 'Consumption'
    },
    'Premium Plan': {
      summary: 'Pre-warmed instances for low latency.',
      description: 'VNET integration and always-ready instances for performance-sensitive functions.',
      tier: 'Premium'
    },
    'Dedicated Plan': {
      summary: 'Runs on dedicated App Service plan.',
      description: 'Predictable performance on reserved compute. Good for steady high-throughput workloads.',
      tier: 'Dedicated'
    }
  },
  'blob storage': {
    Hot: {
      summary: 'Frequently accessed object storage.',
      description: 'Lowest access cost. Best for images, videos, and active datasets.',
      tier: 'Hot'
    },
    Cool: {
      summary: 'Infrequently accessed storage.',
      description: 'Lower storage cost with higher access charges. Good for backups and archives with occasional reads.',
      tier: 'Cool'
    },
    Archive: {
      summary: 'Long-term archival storage.',
      description: 'Lowest storage cost. Retrieval takes hours. Ideal for compliance and long-term retention.',
      tier: 'Archive'
    }
  },
  'sql database': {
    Basic: {
      summary: 'Entry-level managed SQL database.',
      description: '5 DTUs, 2 GB max size. For dev/test and very small apps.',
      tier: 'Basic',
      performance: '5 DTUs'
    },
    S0: {
      summary: 'Small standard-tier database.',
      description: '10 DTUs, 250 GB max. For light production workloads.',
      tier: 'Standard',
      performance: '10 DTUs'
    },
    S1: {
      summary: 'Mid standard-tier database.',
      description: '20 DTUs, 250 GB max. For moderate transactional workloads.',
      tier: 'Standard',
      performance: '20 DTUs'
    },
    S2: {
      summary: 'Higher standard-tier database.',
      description: '50 DTUs, 250 GB max. For busier OLTP applications.',
      tier: 'Standard',
      performance: '50 DTUs'
    },
    P1: {
      summary: 'Premium performance tier.',
      description: '125 DTUs, 500 GB max. IO-intensive production databases.',
      tier: 'Premium',
      performance: '125 DTUs'
    },
    P2: {
      summary: 'High premium performance tier.',
      description: '250 DTUs, 500 GB max. For demanding enterprise databases.',
      tier: 'Premium',
      performance: '250 DTUs'
    }
  },
  'cosmos db': {
    Serverless: {
      summary: 'Pay-per-request Cosmos DB.',
      description: 'No minimum RU charge. Ideal for dev/test and variable traffic.',
      tier: 'Serverless'
    },
    'Provisioned Throughput': {
      summary: 'Fixed RU/s throughput.',
      description: 'Predictable performance with manually set request units.',
      tier: 'Provisioned'
    },
    Autoscale: {
      summary: 'Auto-scaling provisioned throughput.',
      description: 'Scales RU/s between 10% and 100% of max based on demand.',
      tier: 'Autoscale'
    }
  },
  'data lake storage': {
    'Gen2 Standard': {
      summary: 'Standard hierarchical storage.',
      description: 'Cost-effective analytics storage with ADLS Gen2 capabilities.',
      tier: 'Standard'
    },
    'Gen2 Premium': {
      summary: 'Premium block blob storage.',
      description: 'Higher IOPS for analytics pipelines with frequent reads and writes.',
      tier: 'Premium'
    }
  },
  'virtual network': {
    'Small VNet': {
      summary: 'Basic network footprint.',
      description: 'Reader-level access for small subnets and peering review.',
      tier: 'Small'
    },
    'Medium VNet': {
      summary: 'Standard network layout.',
      description: 'Contributor access for typical hub/spoke or single-region designs.',
      tier: 'Medium'
    },
    'Large VNet': {
      summary: 'Enterprise network footprint.',
      description: 'Contributor access for multi-subnet and complex routing designs.',
      tier: 'Large'
    }
  },
  'cdn': {
    'Standard Microsoft': {
      summary: 'Microsoft CDN profile.',
      description: 'Global content delivery with Azure-integrated CDN endpoints.',
      tier: 'Standard Microsoft'
    },
    'Standard Akamai': {
      summary: 'Akamai CDN profile.',
      description: 'Akamai-backed CDN for global edge delivery.',
      tier: 'Standard Akamai'
    },
    'Premium Verizon': {
      summary: 'Premium Verizon CDN profile.',
      description: 'Advanced CDN features including rules engine and analytics.',
      tier: 'Premium Verizon'
    }
  },
  'load balancer': {
    Basic: {
      summary: 'Layer-4 load balancer (Basic SKU).',
      description: 'Read-only visibility. Limited features, no HA port rules.',
      tier: 'Basic'
    },
    Standard: {
      summary: 'Layer-4 load balancer (Standard SKU).',
      description: 'Full HA, zone redundancy, and outbound rules support.',
      tier: 'Standard'
    }
  },
  'application gateway': {
    Standard_v2: {
      summary: 'Layer-7 application gateway.',
      description: 'HTTP(S) load balancing, SSL termination, and path-based routing.',
      tier: 'Standard v2'
    },
    WAF_v2: {
      summary: 'Web Application Firewall gateway.',
      description: 'Standard v2 plus OWASP-managed rule sets for web protection.',
      tier: 'WAF v2'
    }
  },
  'expressroute': {
    '50 Mbps': {
      summary: 'Private 50 Mbps circuit.',
      description: 'Entry private connectivity between on-premises and Azure.',
      tier: '50 Mbps'
    },
    '100 Mbps': {
      summary: 'Private 100 Mbps circuit.',
      description: 'Higher bandwidth for growing hybrid workloads.',
      tier: '100 Mbps'
    },
    '500 Mbps': {
      summary: 'Private 500 Mbps circuit.',
      description: 'Contributor access for enterprise hybrid connectivity.',
      tier: '500 Mbps'
    },
    '1 Gbps': {
      summary: 'Private 1 Gbps circuit.',
      description: 'High-bandwidth dedicated connectivity for large enterprises.',
      tier: '1 Gbps'
    }
  },
  'entra id': {
    Free: {
      summary: 'Free identity tier.',
      description: 'Directory Readers access. Basic authentication and sync.',
      tier: 'Free'
    },
    P1: {
      summary: 'Entra ID P1.',
      description: 'User Administrator access. Conditional access and self-service password reset.',
      tier: 'P1'
    },
    P2: {
      summary: 'Entra ID P2.',
      description: 'User Administrator access plus identity protection and privileged access.',
      tier: 'P2'
    }
  },
  'key vault': {
    'Standard Vault': {
      summary: 'Software-protected secrets vault.',
      description: 'Standard HSM-backed keys and secrets management.',
      tier: 'Standard'
    },
    'Premium Vault': {
      summary: 'HSM-protected vault.',
      description: 'Hardware security module backed keys for higher compliance needs.',
      tier: 'Premium'
    }
  },
  'defender for cloud': {
    'Foundational CSPM': {
      summary: 'Free cloud security posture management.',
      description: 'Security Reader access. Secure score and basic recommendations.',
      tier: 'Foundational'
    },
    'Defender Servers': {
      summary: 'Server workload protection.',
      description: 'Security Admin access. Threat detection for VMs and servers.',
      tier: 'Defender Servers'
    },
    'Defender SQL': {
      summary: 'SQL database protection.',
      description: 'Security Admin access. Vulnerability assessment and threat alerts for SQL.',
      tier: 'Defender SQL'
    }
  },
  'service bus': {
    Basic: {
      summary: 'Basic messaging tier.',
      description: 'Queues and topics with limited features. Good for simple messaging.',
      tier: 'Basic'
    },
    Standard: {
      summary: 'Standard messaging tier.',
      description: 'Full queues, topics, and subscriptions with transactions.',
      tier: 'Standard'
    },
    Premium: {
      summary: 'Premium messaging tier.',
      description: 'Dedicated resources for high throughput and predictable latency.',
      tier: 'Premium'
    }
  },
  'event grid': {
    Basic: {
      summary: 'Event routing at scale.',
      description: 'Contributor access for event subscriptions and routing.',
      tier: 'Basic'
    },
    Standard: {
      summary: 'Standard event grid.',
      description: 'Same contributor capabilities with standard SLA and features.',
      tier: 'Standard'
    }
  },
  'logic apps': {
    Consumption: {
      summary: 'Pay-per-action Logic Apps.',
      description: 'Serverless workflow automation billed per action execution.',
      tier: 'Consumption'
    },
    Standard: {
      summary: 'Dedicated Logic Apps runtime.',
      description: 'Single-tenant workflows with VNET integration and reserved compute.',
      tier: 'Standard'
    }
  },
  'monitor': {
    'Basic Monitoring': {
      summary: 'Essential metrics and alerts.',
      description: 'Platform metrics, activity logs, and basic alerting.',
      tier: 'Basic'
    },
    'Advanced Monitoring': {
      summary: 'Full observability stack.',
      description: 'Metrics, logs, alerts, and dashboards for production operations.',
      tier: 'Advanced'
    }
  },
  'application insights': {
    Basic: {
      summary: 'Application performance monitoring.',
      description: 'Request tracking, dependencies, and failure analytics.',
      tier: 'Basic'
    },
    Enterprise: {
      summary: 'Enterprise APM with extended retention.',
      description: 'Higher data caps and advanced analytics for large apps.',
      tier: 'Enterprise'
    }
  },
  'devops': {
    Basic: {
      summary: 'Basic DevOps plan.',
      description: 'Repos, pipelines, and boards for small teams.',
      tier: 'Basic'
    },
    'Basic + Test Plans': {
      summary: 'Basic plan with test management.',
      description: 'Includes test plans and manual testing tools.',
      tier: 'Basic + Test'
    },
    Stakeholder: {
      summary: 'Stakeholder access only.',
      description: 'View boards and dashboards without code access.',
      tier: 'Stakeholder'
    }
  },
  'openai service': {
    'GPT-4o': {
      summary: 'GPT-4o multimodal model.',
      description: 'Latest OpenAI model for text, vision, and reasoning tasks.',
      tier: 'GPT-4o'
    },
    'GPT-4.1': {
      summary: 'GPT-4.1 model.',
      description: 'High-quality text generation and analysis.',
      tier: 'GPT-4.1'
    },
    'GPT-4 Turbo': {
      summary: 'GPT-4 Turbo model.',
      description: 'Fast, cost-effective GPT-4 class model for production APIs.',
      tier: 'GPT-4 Turbo'
    },
    Embeddings: {
      summary: 'Text embedding models.',
      description: 'Vector embeddings for search, RAG, and similarity workloads.',
      tier: 'Embeddings'
    }
  },
  'ai foundry': {
    Starter: {
      summary: 'Entry AI Foundry workspace.',
      description: 'Experiment with models and prompts in a managed workspace.',
      tier: 'Starter'
    },
    Standard: {
      summary: 'Standard AI Foundry workspace.',
      description: 'Production model deployment and evaluation pipelines.',
      tier: 'Standard'
    },
    Enterprise: {
      summary: 'Enterprise AI Foundry workspace.',
      description: 'Full governance, private endpoints, and enterprise scale.',
      tier: 'Enterprise'
    }
  },
  'ai search': {
    Basic: {
      summary: 'Entry search service.',
      description: 'Small index for dev/test search scenarios.',
      tier: 'Basic'
    },
    'Standard S1': {
      summary: 'Standard search partition.',
      description: 'Production search with replicas and larger indexes.',
      tier: 'Standard S1'
    },
    'Standard S2': {
      summary: 'Larger standard search partition.',
      description: 'Higher capacity for enterprise search and RAG indexes.',
      tier: 'Standard S2'
    }
  },
  'machine learning': {
    'Basic Compute': {
      summary: 'Small ML compute.',
      description: 'CPU notebooks and lightweight training jobs.',
      tier: 'Basic'
    },
    'CPU Cluster': {
      summary: 'CPU training cluster.',
      description: 'Scalable CPU clusters for batch training pipelines.',
      tier: 'CPU'
    },
    'GPU Cluster': {
      summary: 'GPU training cluster.',
      description: 'GPU-backed compute for deep learning and large model training.',
      tier: 'GPU'
    }
  },
  'ai vision': {
    Free: {
      summary: 'Free tier vision API.',
      description: 'Limited calls per month for OCR and image analysis experiments.',
      tier: 'Free'
    },
    Standard: {
      summary: 'Standard vision API.',
      description: 'Production OCR, object detection, and image analysis.',
      tier: 'Standard'
    }
  },
  'ai language': {
    Free: {
      summary: 'Free tier language API.',
      description: 'Limited sentiment and entity extraction calls.',
      tier: 'Free'
    },
    Standard: {
      summary: 'Standard language API.',
      description: 'Production NLP: sentiment, entities, summarization, and more.',
      tier: 'Standard'
    }
  },
  'ai speech': {
    Free: {
      summary: 'Free tier speech services.',
      description: 'Limited speech-to-text and text-to-speech minutes.',
      tier: 'Free'
    },
    Standard: {
      summary: 'Standard speech services.',
      description: 'Production speech recognition, synthesis, and translation.',
      tier: 'Standard'
    }
  },
  'bot service': {
    Basic: {
      summary: 'Basic bot channel registration.',
      description: 'Single-channel bots for Teams or web chat.',
      tier: 'Basic'
    },
    Standard: {
      summary: 'Standard bot hosting.',
      description: 'Multi-channel bots with richer analytics and scaling.',
      tier: 'Standard'
    }
  },
  'document intelligence': {
    Free: {
      summary: 'Free document analysis tier.',
      description: 'Limited pages per month for form and document extraction.',
      tier: 'Free'
    },
    Standard: {
      summary: 'Standard document intelligence.',
      description: 'Production OCR, forms, invoices, and custom model training.',
      tier: 'Standard'
    }
  }
};

const resolveServiceGuideKey = (serviceName) => {
  const normalized = normalizeKey(serviceName);

  if (/virtual machine|\bvm\b/i.test(normalized)) {
    return 'virtual machines';
  }

  for (const key of Object.keys(SERVICE_GUIDES)) {
    if (normalized.includes(key)) {
      return key;
    }
  }

  return null;
};

const buildGuidePayload = (rawGuide, optionName) => {
  if (!rawGuide) {
    return {
      optionName,
      summary: `Azure option: ${optionName}`,
      description: 'Select this tier or size for the chosen service.',
      specs: [],
      tier: optionName
    };
  }

  const specs = [];

  if (rawGuide.vcpu) {
    specs.push({ label: 'vCPU', value: rawGuide.vcpu });
  }
  if (rawGuide.ram) {
    specs.push({ label: 'RAM', value: rawGuide.ram });
  }
  if (rawGuide.storage) {
    specs.push({ label: 'Storage', value: rawGuide.storage });
  }
  if (rawGuide.performance) {
    specs.push({ label: 'Performance', value: rawGuide.performance });
  }

  return {
    optionName,
    summary: rawGuide.summary || `Azure option: ${optionName}`,
    description: rawGuide.description || '',
    tier: rawGuide.tier || optionName,
    specs
  };
};

const resolveInstanceGuide = (serviceName, optionName) => {
  const option = String(optionName || '').trim();
  if (!option) {
    return buildGuidePayload(null, option);
  }

  const serviceKey = resolveServiceGuideKey(serviceName);

  if (serviceKey === 'virtual machines' && VM_GUIDES[option]) {
    return buildGuidePayload(VM_GUIDES[option], option);
  }

  const serviceGuides = serviceKey ? SERVICE_GUIDES[serviceKey] : null;
  if (serviceGuides?.[option]) {
    return buildGuidePayload(serviceGuides[option], option);
  }

  return buildGuidePayload(null, option);
};

module.exports = {
  resolveInstanceGuide,
  resolveServiceGuideKey
};
