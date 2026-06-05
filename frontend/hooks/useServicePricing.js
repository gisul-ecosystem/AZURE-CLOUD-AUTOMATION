'use client';

import { useEffect, useState } from 'react';
import { getServices } from '../services/api';

const CACHE_TTL_MS = 30 * 1000;
const pricingCache = new Map();
const EMPTY_SERVICES = [];

const normalizeService = (service) => {
  const price = Number(service?.retail_price ?? service?.price ?? service?.price_per_user ?? 0);
  const currency = service?.currency || service?.currency_code || 'USD';

  return {
    ...service,
    id: String(service?.id ?? service?.service_name ?? service?.name ?? ''),
    service_name: service?.service_name || service?.name || '',
    service_family: service?.service_family || service?.category || 'Uncategorized',
    retail_price: Number.isFinite(price) ? price : 0,
    currency,
    pricingSource: service?.pricingSource || 'azure',
    display_location: service?.display_location || service?.location || '',
    unit_of_measure: service?.unit_of_measure || service?.unitOfMeasure || ''
  };
};

export default function useServicePricing(location, initialServices = EMPTY_SERVICES) {
  const [services, setServices] = useState(() => initialServices.map(normalizeService));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const resolvedLocation = typeof location === 'string' ? location.trim() : '';

    const loadServicePricing = async () => {
      if (!resolvedLocation) {
        setServices([]);
        setLoading(false);
        setError('');
        return;
      }

      const cachedEntry = pricingCache.get(resolvedLocation);

      if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
        setServices(cachedEntry.value);
        setLoading(false);
        setError('');
        return;
      }

      setLoading(true);

      try {
        const response = await getServices(resolvedLocation);
        console.log('services_response', response);

        const rawServices = Array.isArray(response?.data)
          ? response.data
          : Array.isArray(response?.services)
            ? response.services
            : Array.isArray(response)
              ? response
              : [];

        const nextServices = rawServices.map(normalizeService);

        if (cancelled) {
          return;
        }

        setServices(nextServices);
        console.log('services_state', nextServices);
        pricingCache.set(resolvedLocation, {
          value: nextServices,
          expiresAt: Date.now() + CACHE_TTL_MS
        });
        setError('');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setServices((current) => (current.length > 0 ? current : initialServices.map(normalizeService)));
        setError(error.message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadServicePricing();

    return () => {
      cancelled = true;
    };
  }, [location, refreshTick, initialServices]);

  const refresh = () => {
    if (typeof location === 'string' && location.trim()) {
      pricingCache.delete(location.trim());
    }
    setRefreshTick((current) => current + 1);
  };

  return {
    services,
    loading,
    error,
    refresh
  };
}
