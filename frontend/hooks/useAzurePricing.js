'use client';

import { useEffect, useMemo, useState } from 'react';
import { getAzurePricing } from '../services/api';

const CACHE_TTL_MS = 30 * 60 * 1000;
const pricingCache = new Map();

const normalizeText = (value) => String(value || '').trim();

const getCacheKey = (service, region, sku) =>
  [normalizeText(service).toLowerCase(), normalizeText(region).toLowerCase(), normalizeText(sku).toLowerCase()].join('|');

const getCachedPricing = (cacheKey) => {
  const entry = pricingCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    pricingCache.delete(cacheKey);
    return null;
  }

  return entry.value;
};

const setCachedPricing = (cacheKey, value) => {
  pricingCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
};

export default function useAzurePricing({
  services = [],
  region = '',
  selectedInstancesByServiceId = {}
} = {}) {
  const [pricingByServiceId, setPricingByServiceId] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const normalizedRegion = useMemo(() => normalizeText(region).toLowerCase(), [region]);

  useEffect(() => {
    let cancelled = false;

    const selectedServices = Array.isArray(services) ? services : [];

    if (!normalizedRegion || selectedServices.length === 0) {
      setPricingByServiceId({});
      setLoading(false);
      setError('');
      return undefined;
    }

    setLoading(true);
    setError('');

    const loadPricing = async () => {
      const entries = await Promise.all(
        selectedServices.map(async (service) => {
          const serviceId = Number(service?.id);
          const serviceName = service?.name || service?.service_name || service?.azure_role || service?.category || '';
          const sku = normalizeText(selectedInstancesByServiceId?.[serviceId] || selectedInstancesByServiceId?.[String(serviceId)] || '');

          if (!serviceName) {
            return [serviceId, { price: null, message: 'Pricing unavailable' }];
          }

          const cacheKey = getCacheKey(serviceName, normalizedRegion, sku);
          const cached = getCachedPricing(cacheKey);

          if (cached) {
            return [serviceId, cached];
          }

          try {
            const result = await getAzurePricing({
              service: serviceName,
              region: normalizedRegion,
              sku: sku || undefined
            });

            const nextValue =
              result && typeof result === 'object'
                ? result
                : { price: null, message: 'Pricing unavailable' };

            setCachedPricing(cacheKey, nextValue);
            return [serviceId, nextValue];
          } catch (lookupError) {
            return [
              serviceId,
              {
                price: null,
                message: lookupError?.message || 'Pricing unavailable'
              }
            ];
          }
        })
      );

      if (cancelled) {
        return;
      }

      const nextPricing = {};
      entries.forEach(([serviceId, value]) => {
        if (Number.isInteger(serviceId) && serviceId > 0) {
          nextPricing[serviceId] = value;
        }
      });

      setPricingByServiceId(nextPricing);
      setLoading(false);
    };

    loadPricing().catch((lookupError) => {
      if (cancelled) {
        return;
      }

      setError(lookupError?.message || 'Pricing unavailable');
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [normalizedRegion, services, selectedInstancesByServiceId]);

  return {
    pricingByServiceId,
    loading,
    error
  };
}
