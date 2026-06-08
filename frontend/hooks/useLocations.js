'use client';

import { useEffect, useState } from 'react';
import { getAvailableLocations } from '../services/api';

const CACHE_TTL_MS = 30 * 1000;
const locationsCache = new Map();

const normalizeLocation = (location) => {
  if (typeof location === 'string') {
    const trimmed = location.trim();
    return trimmed
      ? {
          arm_region_name: trimmed.toLowerCase(),
          display_location: trimmed,
          label: trimmed,
          value: trimmed.toLowerCase()
        }
      : null;
  }

  if (location && typeof location === 'object') {
    const armRegionName = String(location.arm_region_name || location.region || location.value || '')
      .trim()
      .toLowerCase();
    const displayLocation = String(location.display_location || location.label || location.name || '').trim();
    const label = displayLocation || armRegionName;
    const value = armRegionName || String(location.value || label).trim().toLowerCase();
    const basePrice = Number(location.basePrice ?? location.base_price ?? location.total_price ?? location.price ?? 0);
    const serviceCount = Number(location.serviceCount ?? location.service_count ?? location.matched ?? 0);
    const currency = String(location.currency || 'USD').trim().toUpperCase() || 'USD';

    if (!label && !value) {
      return null;
    }

    return {
      arm_region_name: value || label,
      display_location: label || value,
      label: label || value,
      value: value || label,
      basePrice: Number.isFinite(basePrice) ? basePrice : 0,
      serviceCount: Number.isFinite(serviceCount) ? serviceCount : 0,
      currency
    };
  }

  return null;
};

const normalizeLocations = (locations) => (Array.isArray(locations) ? locations.map(normalizeLocation).filter(Boolean) : []);

const normalizeServiceIds = (serviceIds) =>
  Array.from(
    new Set(
      (Array.isArray(serviceIds) ? serviceIds : [])
        .map((serviceId) => Number(serviceId))
        .filter((serviceId) => Number.isInteger(serviceId) && serviceId > 0)
    )
  ).sort((left, right) => left - right);

export default function useLocations(serviceIds = []) {
  const resolvedServiceIds = normalizeServiceIds(serviceIds);
  const cacheKey = resolvedServiceIds.join(',');
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadLocations = async () => {
      if (resolvedServiceIds.length === 0) {
        setLocations([]);
        setError('');
        setLoading(false);
        return;
      }

      const cached = locationsCache.get(cacheKey);

      if (cached && cached.expiresAt > Date.now()) {
        setLocations(normalizeLocations(cached.value));
        setError('');
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const nextLocations = normalizeLocations(await getAvailableLocations(resolvedServiceIds));

        if (cancelled) {
          return;
        }

        locationsCache.set(cacheKey, {
          value: nextLocations,
          expiresAt: Date.now() + CACHE_TTL_MS
        });
        setLocations(nextLocations);
        setError('');
      } catch (nextError) {
        if (cancelled) {
          return;
        }

        setError(nextError.message);
        setLocations([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadLocations();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, refreshTick, resolvedServiceIds.length]);

  const refresh = () => {
    if (cacheKey) {
      locationsCache.delete(cacheKey);
    }
    setRefreshTick((current) => current + 1);
  };

  return {
    locations,
    loading,
    error,
    refresh
  };
}
