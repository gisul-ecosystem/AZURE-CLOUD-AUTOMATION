const { resolveInstanceGuide } = require('../config/instanceCatalog');
const { getServiceRegionalDailyPrices } = require('./estimatePricingService');

const DEFAULT_PRICE_REGION = 'eastus';

const enrichInstances = async (instances, servicesById, location = '') => {
  const normalizedLocation = String(location || '').trim().toLowerCase();
  const priceRegion = normalizedLocation || DEFAULT_PRICE_REGION;
  const priceIsEstimate = !normalizedLocation;

  return Promise.all(
    instances.map(async (instance) => {
      const serviceId = Number(instance.serviceId ?? instance.service_id);
      const service = servicesById.get(serviceId);
      const optionName = String(instance.option_name || '').trim();
      const guide = resolveInstanceGuide(service?.name, optionName);

      let dailyPrice = null;
      let currency = 'USD';

      if (service) {
        try {
          const priceByRegion = await getServiceRegionalDailyPrices(service, optionName);
          const regionalPrice = priceByRegion.get(priceRegion);

          if (Number.isFinite(regionalPrice)) {
            const portalDaily = Math.max(0, Number(service.price_per_user || 0));
            dailyPrice = regionalPrice + portalDaily;
          }
        } catch {
          dailyPrice = null;
        }
      }

      return {
        ...instance,
        guide,
        dailyPrice,
        currency,
        priceRegion,
        priceIsEstimate
      };
    })
  );
};

module.exports = {
  enrichInstances,
  resolveInstanceGuide
};
