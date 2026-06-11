const isVirtualMachineService = (serviceName) => /virtual machine/i.test(String(serviceName || ''));

const normalizeVmSize = (instanceOption) => {
  const raw = String(instanceOption || '').trim();
  if (!raw) {
    return 'Standard_B1s';
  }

  const compact = raw.replace(/\s+/g, '_');
  if (compact.startsWith('Standard_')) {
    return compact;
  }

  return `Standard_${compact}`;
};

const VM_SIZE_FALLBACKS = {
  Standard_B1s: ['Standard_B1ms', 'Standard_B2s', 'Standard_B2ms', 'Standard_D2s_v5'],
  Standard_B1ms: ['Standard_B2s', 'Standard_B2ms', 'Standard_D2s_v5'],
  Standard_B2s: ['Standard_B2ms', 'Standard_D2s_v5', 'Standard_D4s_v5'],
  Standard_B2ms: ['Standard_D2s_v5', 'Standard_D4s_v5'],
  Standard_D2s_v5: ['Standard_D4s_v5', 'Standard_E2s_v5'],
  Standard_D4s_v5: ['Standard_D8s_v5', 'Standard_E4s_v5'],
  Standard_D8s_v5: ['Standard_E8s_v5'],
  Standard_E2s_v5: ['Standard_E4s_v5', 'Standard_D4s_v5'],
  Standard_E4s_v5: ['Standard_E8s_v5', 'Standard_D8s_v5'],
  Standard_E8s_v5: ['Standard_D8s_v5']
};

const getVmSizeFallbackChain = (instanceOption) => {
  const primary = normalizeVmSize(instanceOption);
  const fallbacks = VM_SIZE_FALLBACKS[primary] || [];
  return [primary, ...fallbacks];
};

const isVmCapacityError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('capacity restriction') ||
    message.includes('capacity restrictions') ||
    message.includes('skunotavailable') ||
    message.includes('sku is currently not available') ||
    message.includes('not available in location')
  );
};

module.exports = {
  isVirtualMachineService,
  normalizeVmSize,
  getVmSizeFallbackChain,
  isVmCapacityError
};
