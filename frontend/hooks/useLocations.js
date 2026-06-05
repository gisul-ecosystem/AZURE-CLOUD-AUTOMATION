'use client';

import { useEffect, useState } from 'react';
import { getLocations } from '../services/api';

const CACHE_TTL_MS = 30 * 1000;
const locationsCache = {
  value: null,
  expiresAt: 0
};

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
    const armRegionName = String(location.arm_region_name || location.value || location.location || '').trim().toLowerCase();
    const displayLocation = String(location.display_location || location.label || location.name || '').trim();
    const label = displayLocation || armRegionName;
    const value = armRegionName || String(location.value || location.location || label).trim().toLowerCase();

    if (!label && !value) {
      return null;
    }

    return {
      arm_region_name: value || label,
      display_location: label || value,
      label: label || value,
      value: value || label
    };
  }

  return null;
};

const normalizeLocations = (locations) => (Array.isArray(locations) ? locations.map(normalizeLocation).filter(Boolean) : []);

export default function useLocations() {
  const [locations, setLocations] = useState(() => normalizeLocations(locationsCache.value || []));
  const [loading, setLoading] = useState(!locationsCache.value);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadLocations = async () => {
      const cached = locationsCache.value;

      if (cached && locationsCache.expiresAt > Date.now()) {
        setLocations(normalizeLocations(cached));
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const nextLocations = normalizeLocations(await getLocations());

        if (cancelled) {
          return;
        }

        locationsCache.value = nextLocations;
        locationsCache.expiresAt = Date.now() + CACHE_TTL_MS;
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
  }, [refreshTick]);

  const refresh = () => {
    locationsCache.expiresAt = 0;
    setRefreshTick((current) => current + 1);
  };

  return {
    locations,
    loading,
    error,
    refresh
  };
}
