'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchProvisionSnapshot,
  provisionResourceGroup,
  provisionRoles,
  provisionUsers,
  sendCredentials
} from '../services/api';
import { clamp } from '../utils/formatters';

const STEP_DEFINITIONS = [
  {
    key: 'resource-group',
    title: 'Resource Group Creating',
    description: 'Create the Azure resource group in the chosen region.'
  },
  {
    key: 'users',
    title: 'Users Creating',
    description: 'Create the Microsoft Graph users for this request.'
  },
  {
    key: 'roles',
    title: 'Assigning Access',
    description: 'Assign the resolved RBAC roles at resource-group scope.'
  },
  {
    key: 'credentials',
    title: 'Sending Access Link',
    description: 'Email the secure manage-users link to the customer.'
  }
];

const createEvent = (kind, title, message) => ({
  kind,
  title,
  message,
  timestamp: new Date().toISOString()
});

const truthyStatus = (value) => String(value || '').toLowerCase();

const getRequestData = (snapshot) => snapshot?.request?.data || snapshot?.request || null;
const getProvisionData = (snapshot) => snapshot?.provision?.data || snapshot?.provision || null;
const getUsersData = (snapshot) => snapshot?.users?.data || snapshot?.users || null;
const getRolesData = (snapshot) => snapshot?.roles?.data || snapshot?.roles || null;
const getCredentialsData = (snapshot) => snapshot?.credentials?.data || snapshot?.credentials || null;

const hasResourceGroup = (snapshot) =>
  Boolean(
    getProvisionData(snapshot)?.resourceGroup ||
      getProvisionData(snapshot)?.resourceGroupName ||
      getRequestData(snapshot)?.azure_resource_group_name
  );

const getUsersCount = (snapshot) => {
  const usersData = getUsersData(snapshot);
  if (Array.isArray(usersData)) return usersData.length;
  return Number(usersData?.usersCreated || usersData?.users?.length || 0);
};

const getRolesCount = (snapshot) => {
  const rolesData = getRolesData(snapshot);
  if (Array.isArray(rolesData)) return rolesData.length;
  return Number(rolesData?.rolesAssigned || rolesData?.roles?.length || 0);
};

const getDeliveryStatus = (snapshot) =>
  String(getCredentialsData(snapshot)?.deliveryStatus || 'Pending');

const hasCompletedFlow = (snapshot) =>
  truthyStatus(getRequestData(snapshot)?.status) === 'completed' &&
  hasResourceGroup(snapshot) &&
  getUsersCount(snapshot) > 0 &&
  getRolesCount(snapshot) > 0 &&
  truthyStatus(getDeliveryStatus(snapshot)) === 'sent';

const deriveProgress = (snapshot) => {
  const stepsComplete = [
    hasResourceGroup(snapshot),
    getUsersCount(snapshot) > 0,
    getRolesCount(snapshot) > 0,
    truthyStatus(getDeliveryStatus(snapshot)) === 'sent'
  ].filter(Boolean).length;

  return stepsComplete * 25;
};

const deriveStepStates = (snapshot, activeStepKey = '') =>
  STEP_DEFINITIONS.map((step) => {
    let state = 'pending';

    if (step.key === 'resource-group') {
      state = hasResourceGroup(snapshot) ? 'complete' : activeStepKey === step.key ? 'active' : 'pending';
    } else if (step.key === 'users') {
      state =
        getUsersCount(snapshot) > 0
          ? 'complete'
          : activeStepKey === step.key
            ? 'active'
            : hasResourceGroup(snapshot)
              ? 'active'
              : 'pending';
    } else if (step.key === 'roles') {
      state =
        getRolesCount(snapshot) > 0
          ? 'complete'
          : activeStepKey === step.key
            ? 'active'
            : getUsersCount(snapshot) > 0
              ? 'active'
              : 'pending';
    } else if (step.key === 'credentials') {
      state =
        truthyStatus(getDeliveryStatus(snapshot)) === 'sent'
          ? 'complete'
          : activeStepKey === step.key
            ? 'active'
            : getRolesCount(snapshot) > 0
              ? 'active'
              : 'pending';
    }

    return { ...step, state };
  });

const EMPTY_SNAPSHOT = {
  request: null,
  provision: null,
  users: null,
  roles: null,
  credentials: null
};

export function useProvisionFlow(requestId, initialSnapshot = null) {
  const [snapshot, setSnapshot] = useState(initialSnapshot || EMPTY_SNAPSHOT);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeStep, setActiveStep] = useState('');
  const snapshotRef = useRef(snapshot);
  const timerRef = useRef(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const refresh = async () => {
    if (!requestId) return null;

    setRefreshing(true);

    try {
      const nextSnapshot = await fetchProvisionSnapshot(requestId);
      setSnapshot(nextSnapshot);
      setLastUpdated(new Date().toISOString());
      return nextSnapshot;
    } catch (nextError) {
      setError(nextError.message);
      throw nextError;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const appendEvent = (kind, title, message) => {
    setEvents((current) => [createEvent(kind, title, message), ...current].slice(0, 20));
  };

  const runOrchestration = async () => {
    if (!requestId || inFlightRef.current) return;

    inFlightRef.current = true;
    setRunning(true);
    setError('');

    try {
      const currentSnapshot = snapshotRef.current.request ? snapshotRef.current : await refresh();
      const currentStatus = truthyStatus(getRequestData(currentSnapshot)?.status);

      if (hasCompletedFlow(currentSnapshot) || currentStatus === 'expired') {
        setActiveStep('');
        return;
      }

      const steps = [
        {
          key: 'resource-group',
          title: 'Resource Group Creating',
          action: () => provisionResourceGroup(requestId)
        },
        {
          key: 'users',
          title: 'Users Creating',
          action: () => provisionUsers(requestId)
        },
        {
          key: 'roles',
          title: 'Assigning Access',
          action: () => provisionRoles(requestId)
        },
        {
          key: 'credentials',
          title: 'Sending Access Link',
          action: () => sendCredentials(requestId)
        }
      ];

      for (const step of steps) {
        const latestSnapshot = snapshotRef.current;
        const isComplete =
          (step.key === 'resource-group' && hasResourceGroup(latestSnapshot)) ||
          (step.key === 'users' && getUsersCount(latestSnapshot) > 0) ||
          (step.key === 'roles' && getRolesCount(latestSnapshot) > 0) ||
          (step.key === 'credentials' && truthyStatus(getDeliveryStatus(latestSnapshot)) === 'sent');

        if (isComplete) {
          continue;
        }

        setActiveStep(step.key);
        appendEvent('info', step.title, `Starting ${step.title.toLowerCase()}.`);

        await step.action();
        const nextSnapshot = await refresh();

        appendEvent('success', step.title, `${step.title} completed.`);

        if (step.key === 'credentials' && truthyStatus(getDeliveryStatus(nextSnapshot)) === 'sent') {
          break;
        }
      }

      await refresh();
    } catch (flowError) {
      setError(flowError.message);
      appendEvent('error', 'Provisioning failed', flowError.message);
    } finally {
      setActiveStep('');
      setRunning(false);
      inFlightRef.current = false;
    }
  };

  const retry = async () => {
    setError('');
    await refresh();
    await runOrchestration();
  };

  useEffect(() => {
    if (!requestId) return undefined;

    let cancelled = false;

    const boot = async () => {
      setLoading(true);
      try {
        await refresh();
        if (!cancelled) {
          await runOrchestration();
        }
      } catch (bootError) {
        if (!cancelled) {
          setError(bootError.message);
        }
      }
    };

    boot();

    timerRef.current = window.setInterval(() => {
      if (!inFlightRef.current) {
        refresh().catch(() => {});
      }
    }, 4000);

    return () => {
      cancelled = true;
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
    };
  }, [requestId]);

  const derived = useMemo(() => {
    const progress = clamp(deriveProgress(snapshot), 0, 100);
    const stepStates = deriveStepStates(snapshot, activeStep);
    const requestRecord = getRequestData(snapshot) || {};

    return {
      progress,
      stepStates,
      requestRecord,
      resourceGroup:
        getProvisionData(snapshot)?.resourceGroup ||
        getProvisionData(snapshot)?.resourceGroupName ||
        getRequestData(snapshot)?.azure_resource_group_name ||
        '-',
      usersCreated: getUsersCount(snapshot),
      rolesAssigned: getRolesCount(snapshot),
      deliveryStatus: getDeliveryStatus(snapshot),
      completed: hasCompletedFlow(snapshot)
    };
  }, [activeStep, snapshot]);

  return {
    ...derived,
    error,
    loading,
    running,
    refreshing,
    lastUpdated,
    events,
    refresh,
    retry,
    runOrchestration
  };
}
