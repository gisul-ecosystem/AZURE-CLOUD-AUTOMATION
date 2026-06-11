const AppError = require('../utils/AppError');
const { calculateEstimate } = require('./estimatePricingService');

const calculatePricing = async (payload = {}) => {
  const result = await calculateEstimate({
    accountCount: payload.accountCount,
    serviceIds: payload.serviceIds,
    location: payload.location,
    startDate: payload.startDate,
    endDate: payload.endDate,
    selectedInstances: payload.selectedInstances,
    selectedRoles: payload.selectedRoles
  });

  return {
    success: true,
    services: result.services,
    basePrice: result.basePrice,
    duration: result.duration,
    accounts: result.accounts,
    totalPrice: result.totalPrice,
    currency: result.currency,
    roleCount: result.roleCount,
    estimatedPrice: result.totalPrice
  };
};

module.exports = {
  calculatePricing
};
