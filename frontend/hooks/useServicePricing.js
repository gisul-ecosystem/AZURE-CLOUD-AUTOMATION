'use client';

import { useEffect, useState } from 'react';
import { getServices } from '../services/api';

const CACHE_TTL_MS = 30 * 1000;
const pricingCache = new Map();
const EMPTY_SERVICES = [];
const EMPTY_CATEGORIES = [];
const EMPTY_ROLES = [];
const EMPTY_REGIONS = [];
const EMPTY_INSTANCES = [];
const EMPTY_INSTANCE_ROLE_MAPPINGS = [];

const normalizeService = (service) => {
  const price = Number(service?.retail_price ?? service?.price ?? service?.price_per_user ?? 0);
  const currency = service?.currency || 'USD';

  return {
    ...service,
    id: String(service?.id ?? service?.service_name ?? service?.name ?? ''),
    service_name: service?.service_name || service?.name || '',
    service_family: service?.service_family || service?.category || 'General',
    category: service?.category || service?.service_family || 'General',
    retail_price: Number.isFinite(price) ? price : 0,
    currency,
    pricing_source: service?.pricing_source || service?.pricingSource || 'Fallback',
    display_location: service?.display_location || service?.location || '',
    unit_of_measure: service?.unit_of_measure || service?.unitOfMeasure || '',
    location_count: Number(service?.location_count ?? service?.availableRegions ?? service?.available_regions ?? 0) || 0
  };
};

export default function useServicePricing(initialServices = EMPTY_SERVICES) {
  const [services, setServices] = useState(() => initialServices.map(normalizeService));
  const [categories, setCategories] = useState(EMPTY_CATEGORIES);
  const [roles, setRoles] = useState(EMPTY_ROLES);
  const [regions, setRegions] = useState(EMPTY_REGIONS);
  const [instances, setInstances] = useState(EMPTY_INSTANCES);
  const [instanceRoleMappings, setInstanceRoleMappings] = useState(EMPTY_INSTANCE_ROLE_MAPPINGS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = '__catalog__';

    const loadServicePricing = async () => {
      const cachedEntry = pricingCache.get(cacheKey);

      if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
        setServices(cachedEntry.value.services);
        setCategories(cachedEntry.value.categories);
        setRoles(cachedEntry.value.roles);
        setRegions(cachedEntry.value.regions);
        setInstances(cachedEntry.value.instances);
        setInstanceRoleMappings(cachedEntry.value.instanceRoleMappings || EMPTY_INSTANCE_ROLE_MAPPINGS);
        setLoading(false);
        setError('');
        return;
      }

      setLoading(true);

      try {
        const response = await getServices();
        console.log('services_response', response);

        const rawServices = Array.isArray(response?.services)
          ? response.services
          : Array.isArray(response?.data)
            ? response.data
            : Array.isArray(response)
              ? response
              : [];

        const nextServices = rawServices.map(normalizeService);
        const nextCategories = Array.isArray(response?.categories) ? response.categories : [];
        const nextRoles = Array.isArray(response?.roles) ? response.roles : [];
        const nextRegions = Array.isArray(response?.regions) ? response.regions : [];
        const nextInstances = Array.isArray(response?.instances) ? response.instances : [];
        const nextInstanceRoleMappings = Array.isArray(response?.instanceRoleMappings)
          ? response.instanceRoleMappings
          : [];

        if (cancelled) {
          return;
        }

        setServices(nextServices);
        setCategories(nextCategories);
        setRoles(nextRoles);
        setRegions(nextRegions);
        setInstances(nextInstances);
        setInstanceRoleMappings(nextInstanceRoleMappings);
        console.log('services_state', nextServices);
        pricingCache.set(cacheKey, {
          value: {
            services: nextServices,
            categories: nextCategories,
            roles: nextRoles,
            regions: nextRegions,
            instances: nextInstances,
            instanceRoleMappings: nextInstanceRoleMappings
          },
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
  }, [refreshTick, initialServices]);

  const refresh = () => {
    pricingCache.delete('__catalog__');
    setRefreshTick((current) => current + 1);
  };

  return {
    services,
    categories,
    roles,
    regions,
    instances,
    instanceRoleMappings,
    loading,
    error,
    refresh
  };
}
