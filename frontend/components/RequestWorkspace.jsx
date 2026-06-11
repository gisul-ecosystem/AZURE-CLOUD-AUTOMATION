'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PricingSummary from './PricingSummary';
import RequestForm from './RequestForm';
import RequestTimeline from './RequestTimeline';
import { calculatePricingEstimate, createRequestWithPricing, getAvailableInstances } from '../services/api';
import useAzurePricing from '../hooks/useAzurePricing';
import useLocations from '../hooks/useLocations';
import useServicePricing from '../hooks/useServicePricing';

const pad = (value) => String(value).padStart(2, '0');

const formatLocalDate = (date) =>
  [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-');

const formatLocalDateTime = (date) =>
  `${formatLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

const getTodayDateTime = () => formatLocalDateTime(new Date());

const getDateTimePlusDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatLocalDateTime(date);
};

const getPositiveInteger = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export default function RequestWorkspace() {
  const router = useRouter();
  const [selectedServices, setSelectedServices] = useState([]);
  const [serviceRolesByServiceId, setServiceRolesByServiceId] = useState({});
  const [selectedRolesByServiceId, setSelectedRolesByServiceId] = useState({});
  const [selectedInstancesByServiceId, setSelectedInstancesByServiceId] = useState({});
  const [instancesByServiceId, setInstancesByServiceId] = useState({});
  const [instancesLoading, setInstancesLoading] = useState(false);
  const [instancesError, setInstancesError] = useState('');
  const selectedServiceIds = useMemo(
    () =>
      selectedServices
        .map((id) => Number(id))
        .filter((value) => Number.isInteger(value) && value > 0),
    [selectedServices]
  );
  const instanceSelections = useMemo(
    () =>
      Object.entries(selectedInstancesByServiceId)
        .filter(([, instanceOption]) => String(instanceOption || '').trim().length > 0)
        .map(([serviceId, instanceOption]) => `${serviceId}:${instanceOption}`)
        .join(','),
    [selectedInstancesByServiceId]
  );
  const { locations, loading: locationsLoading, error: locationsError } = useLocations(
    selectedServiceIds,
    instanceSelections
  );
  const [form, setForm] = useState({
    customerEmail: '',
    accountCount: '',
    location: '',
    startDate: getTodayDateTime(),
    endDate: getDateTimePlusDays(30),
    enableDailyUsage: false,
    dailyLimitHours: ''
  });
  const [pricing, setPricing] = useState({
    loading: false,
    error: '',
    totalPrice: null,
    basePrice: null,
    duration: 0,
    accounts: 0,
    services: 0
  });
  const [submitError, setSubmitError] = useState('');
  const [submitDebug, setSubmitDebug] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const {
    services: pricedServices,
    categories,
    roles: catalogRoles,
    instances: catalogInstances,
    instanceRoleMappings,
    loading: servicesLoading,
    error: servicesError
  } = useServicePricing();

  useEffect(() => {
    const nextRolesByServiceId = {};

    catalogRoles.forEach((role) => {
      const serviceId = Number(role.serviceId ?? role.service_id);

      if (!Number.isInteger(serviceId) || serviceId <= 0) {
        return;
      }

      if (!nextRolesByServiceId[serviceId]) {
        nextRolesByServiceId[serviceId] = [];
      }

      nextRolesByServiceId[serviceId].push({
        id: Number(role.id),
        azure_role: role.azure_role
      });
    });

    setServiceRolesByServiceId(nextRolesByServiceId);
  }, [catalogRoles]);

  const instanceRoleMappingIndex = useMemo(() => {
    const index = new Map();

    (instanceRoleMappings || []).forEach((mapping) => {
      const serviceId = Number(mapping.serviceId ?? mapping.service_id);
      const instanceOption = String(mapping.instanceOption ?? mapping.instance_option ?? '').trim().toLowerCase();

      if (!Number.isInteger(serviceId) || serviceId <= 0 || !instanceOption) {
        return;
      }

      if (!index.has(serviceId)) {
        index.set(serviceId, new Map());
      }

      index.get(serviceId).set(instanceOption, mapping);
    });

    return index;
  }, [instanceRoleMappings]);

  useEffect(() => {
    let cancelled = false;
    const selectedIdSet = new Set(selectedServices.map((id) => String(id)));
    const instanceServiceIds = pricedServices
      .filter((service) => selectedIdSet.has(String(service.id)) && service.supports_instances === true)
      .map((service) => Number(service.id))
      .filter((serviceId) => Number.isInteger(serviceId) && serviceId > 0);

    const applyCatalogInstances = () => {
      const nextInstancesByServiceId = {};

      catalogInstances.forEach((instance) => {
        const serviceId = Number(instance.serviceId ?? instance.service_id);

        if (!instanceServiceIds.includes(serviceId)) {
          return;
        }

        if (!nextInstancesByServiceId[serviceId]) {
          nextInstancesByServiceId[serviceId] = [];
        }

        nextInstancesByServiceId[serviceId].push({
          id: Number(instance.id),
          option_name: instance.option_name
        });
      });

      setInstancesByServiceId(nextInstancesByServiceId);
    };

    if (!form.location || instanceServiceIds.length === 0) {
      applyCatalogInstances();
      setInstancesLoading(false);
      setInstancesError('');
      return undefined;
    }

    setInstancesLoading(true);

    getAvailableInstances(form.location, instanceServiceIds)
      .then((instances) => {
        if (cancelled) {
          return;
        }

        const nextInstancesByServiceId = {};

        instances.forEach((instance) => {
          const serviceId = Number(instance.serviceId ?? instance.service_id);

          if (!Number.isInteger(serviceId) || serviceId <= 0) {
            return;
          }

          if (!nextInstancesByServiceId[serviceId]) {
            nextInstancesByServiceId[serviceId] = [];
          }

          nextInstancesByServiceId[serviceId].push({
            id: Number(instance.id),
            option_name: instance.option_name
          });
        });

        setInstancesByServiceId(nextInstancesByServiceId);
        setInstancesError('');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setInstancesError(error.message);
        applyCatalogInstances();
      })
      .finally(() => {
        if (!cancelled) {
          setInstancesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [catalogInstances, form.location, pricedServices, selectedServices]);

  useEffect(() => {
    setSelectedInstancesByServiceId((current) => {
      let changed = false;
      const next = { ...current };

      for (const [serviceId, instanceOption] of Object.entries(current)) {
        const available = instancesByServiceId[serviceId] || [];
        const optionNames = available.map((instance) => instance.option_name);

        if (instanceOption && !optionNames.includes(instanceOption)) {
          next[serviceId] = optionNames[0] || '';
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [instancesByServiceId, form.location]);

  useEffect(() => {
    setForm((current) => (current.location ? { ...current, location: '' } : current));
    setPricing({
      loading: false,
      error: '',
      totalPrice: null,
      basePrice: null,
      duration: 0,
      accounts: 0,
      services: 0
    });
  }, [selectedServiceIds.join(',')]);

  useEffect(() => {
    if (selectedServiceIds.length === 0 || locationsLoading || locations.length === 0) {
      return;
    }

    const hasCurrentLocation = locations.some(
      (region) => (region.arm_region_name || region.value) === form.location
    );

    if (!form.location || !hasCurrentLocation) {
      setForm((current) => ({
        ...current,
        location: locations[0].arm_region_name || locations[0].value
      }));
    }
  }, [form.location, locations, locationsLoading, selectedServiceIds.length]);

  useEffect(() => {
    const availableIds = new Set(pricedServices.map((service) => Number(service.id)));
    setSelectedServices((current) => current.filter((id) => availableIds.has(Number(id))));
  }, [pricedServices]);

  const selectedCatalogServices = useMemo(() => {
    const selectedIds = new Set(selectedServices.map((id) => String(id)));
    return pricedServices.filter((service) => selectedIds.has(String(service.id)));
  }, [pricedServices, selectedServices]);

  const {
    pricingByServiceId: livePricingByServiceId,
    loading: livePricingLoading,
    error: livePricingError
  } = useAzurePricing({
    services: selectedCatalogServices,
    region: form.location,
    selectedInstancesByServiceId
  });

  const livePricingItems = useMemo(
    () =>
      selectedCatalogServices.map((service) => {
        const pricing = livePricingByServiceId[Number(service.id)] || {};
        const serviceName = service.name || service.service_name || service.azure_role || service.category || 'Unnamed service';
        const sku = String(selectedInstancesByServiceId[Number(service.id)] || selectedInstancesByServiceId[String(service.id)] || '').trim();

        return {
          key: `${service.id}-${form.location || 'no-region'}-${sku || 'no-sku'}`,
          name: serviceName,
          region: pricing.location || form.location || '',
          sku: pricing.sku || sku || '',
          unit: pricing.unit || '',
          displayPrice: pricing.displayPrice || null,
          message: pricing.message || 'Pricing unavailable'
        };
      }),
    [form.location, livePricingByServiceId, selectedCatalogServices, selectedInstancesByServiceId]
  );

  const selectedServiceInstanceEntries = useMemo(() => {
    return selectedCatalogServices.map((catalogService) => {
      const backendServiceId = Number(catalogService.id);
      const availableInstances = backendServiceId ? instancesByServiceId[backendServiceId] || [] : [];
      const selectedInstance = backendServiceId ? selectedInstancesByServiceId[backendServiceId] || '' : '';
      const supportsInstances = catalogService.supports_instances === true;
      const tierAutomatedRole = backendServiceId
        ? instanceRoleMappingIndex.get(backendServiceId)?.get(String(selectedInstance || '').trim().toLowerCase())
            ?.azureRole ||
          instanceRoleMappingIndex.get(backendServiceId)?.get(String(selectedInstance || '').trim().toLowerCase())
            ?.azure_role ||
          null
        : null;
      const tierAutomated = Boolean(
        tierAutomatedRole &&
          instanceRoleMappingIndex.get(backendServiceId)?.get(String(selectedInstance || '').trim().toLowerCase())
            ?.tierAutomated
      );

      return {
        backendServiceId,
        name: catalogService.name || catalogService.service_name || 'Unnamed service',
        availableInstances,
        selectedInstance,
        supportsInstances,
        tierAutomated,
        resolveInstanceRole: (instanceOption) => {
          const mapping = instanceRoleMappingIndex
            .get(backendServiceId)
            ?.get(String(instanceOption || '').trim().toLowerCase());

          if (!mapping?.tierAutomated) {
            return null;
          }

          return String(mapping.azureRole || mapping.azure_role || '').trim() || null;
        }
      };
    });
  }, [instancesByServiceId, selectedCatalogServices, selectedInstancesByServiceId, instanceRoleMappingIndex]);

  const selectedServiceRoleEntries = useMemo(() => {
    const lookupTierRole = (serviceId, instanceOption) => {
      const mapping = instanceRoleMappingIndex
        .get(Number(serviceId))
        ?.get(String(instanceOption || '').trim().toLowerCase());

      if (!mapping?.tierAutomated) {
        return null;
      }

      return String(mapping.azureRole || mapping.azure_role || '').trim() || null;
    };

    return selectedCatalogServices.map((catalogService) => {
      const backendServiceId = Number(catalogService.id);
      const availableRoles = backendServiceId ? serviceRolesByServiceId[backendServiceId] || [] : [];
      const selectedRoles = backendServiceId ? selectedRolesByServiceId[backendServiceId] || [] : [];
      const selectedInstance = backendServiceId ? selectedInstancesByServiceId[backendServiceId] || '' : '';
      const tierAutomatedRole = backendServiceId
        ? lookupTierRole(backendServiceId, selectedInstance)
        : null;
      const tierAutomated = Boolean(tierAutomatedRole);
      const enableRoleSelection = tierAutomated
        ? false
        : catalogService.enable_role_selection !== false;
      const defaultRole = tierAutomated
        ? tierAutomatedRole
        : catalogService.default_role || null;
      const roleRequired = catalogService.role_required !== false;

      return {
        catalogServiceId: backendServiceId,
        name: catalogService.name || catalogService.service_name || 'Unnamed service',
        backendServiceId,
        availableRoles,
        selectedRoles,
        selectedInstance,
        enableRoleSelection,
        defaultRole,
        roleRequired,
        tierAutomated,
        tierAutomatedRole,
        loading: servicesLoading
      };
    });
  }, [
    pricedServices,
    selectedCatalogServices,
    selectedRolesByServiceId,
    selectedInstancesByServiceId,
    serviceRolesByServiceId,
    instanceRoleMappingIndex,
    servicesLoading
  ]);

  useEffect(() => {
    const activeBackendServiceIds = new Set(
      selectedServiceRoleEntries
        .map((entry) => entry.backendServiceId)
        .filter((value) => Number.isInteger(value) && value > 0)
    );

    setSelectedRolesByServiceId((current) => {
      const next = {};
      let changed = false;

      for (const [serviceId, roles] of Object.entries(current)) {
        if (activeBackendServiceIds.has(Number(serviceId))) {
          next[serviceId] = roles;
        } else {
          changed = true;
        }
      }

      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);

      if (
        !changed &&
        currentKeys.length === nextKeys.length &&
        currentKeys.every((key) => {
          const currentRoles = Array.isArray(current[key]) ? current[key] : [];
          const nextRoles = Array.isArray(next[key]) ? next[key] : [];
          return (
            currentRoles.length === nextRoles.length &&
            currentRoles.every((role, index) => role === nextRoles[index])
          );
        })
      ) {
        return current;
      }

      return next;
    });
  }, [selectedServiceRoleEntries]);

  useEffect(() => {
    const activeBackendServiceIds = new Set(
      selectedServiceInstanceEntries
        .map((entry) => entry.backendServiceId)
        .filter((value) => Number.isInteger(value) && value > 0)
    );

    setSelectedInstancesByServiceId((current) => {
      const next = {};
      let changed = false;

      for (const [serviceId, instanceOption] of Object.entries(current)) {
        if (activeBackendServiceIds.has(Number(serviceId))) {
          next[serviceId] = instanceOption;
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [selectedServiceInstanceEntries]);

  useEffect(() => {
    setSelectedRolesByServiceId((current) => {
      let next = null;

      for (const entry of selectedServiceRoleEntries) {
        if (!entry.tierAutomated || !entry.backendServiceId || !entry.tierAutomatedRole) {
          continue;
        }

        const key = String(entry.backendServiceId);
        const autoRoles = [entry.tierAutomatedRole];
        const currentRoles = Array.isArray(current[key]) ? current[key] : [];

        if (
          currentRoles.length === autoRoles.length &&
          currentRoles.every((role, index) => role === autoRoles[index])
        ) {
          continue;
        }

        if (!next) {
          next = { ...current };
        }

        next[key] = autoRoles;
      }

      return next || current;
    });
  }, [selectedServiceRoleEntries]);

  const selectedInstancesPayload = useMemo(
    () =>
      selectedServiceInstanceEntries
        .filter((entry) => entry.supportsInstances && entry.selectedInstance)
        .map((entry) => ({
          serviceId: Number(entry.backendServiceId),
          instanceOption: entry.selectedInstance
        })),
    [selectedServiceInstanceEntries]
  );

  const selectedDuration = useMemo(() => {
    if (!form.startDate || !form.endDate) {
      return { hours: 0, days: 0 };
    }

    const start = new Date(form.startDate).getTime();
    const end = new Date(form.endDate).getTime();

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return { hours: 0, days: 0 };
    }

    const hours = (end - start) / 3600000;

    return {
      hours,
      days: hours / 24
    };
  }, [form.startDate, form.endDate]);

  const selectedRolesPayload = useMemo(
    () =>
      selectedServiceRoleEntries
        .map((entry) => {
          if (entry.tierAutomated && entry.tierAutomatedRole && entry.backendServiceId) {
            return {
              serviceId: Number(entry.backendServiceId),
              roles: [entry.tierAutomatedRole]
            };
          }

          // If role selection is disabled, auto-assign default role
          if (!entry.enableRoleSelection && entry.defaultRole && entry.backendServiceId) {
            console.log(`[ROLE_AUTO_ASSIGNED] Service ${entry.name}: ${entry.defaultRole}`);
            return {
              serviceId: Number(entry.backendServiceId),
              roles: [entry.defaultRole]
            };
          }
          
          // If role selection is enabled, use manually selected roles
          if (entry.enableRoleSelection && entry.backendServiceId && entry.selectedRoles.length > 0) {
            return {
              serviceId: Number(entry.backendServiceId),
              roles: entry.selectedRoles
            };
          }
          
          // If role is not required and no roles selected, allow empty
          if (!entry.roleRequired && entry.backendServiceId) {
            return {
              serviceId: Number(entry.backendServiceId),
              roles: []
            };
          }
          
          return null;
        })
        .filter(Boolean),
    [selectedServiceRoleEntries]
  );

  const updateField = (event) => {
    const { name, value } = event.target;
    setSubmitError('');
    setSubmitDebug('');
    
    // Handle checkbox
    if (name === 'enableDailyUsage') {
      setForm((current) => ({
        ...current,
        [name]: value
      }));
      return;
    }
    
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  };

  const parsedAccountCount = getPositiveInteger(form.accountCount);

  const buildPricingPayload = () => ({
    accountCount: Number(form.accountCount),
    serviceIds: selectedServiceIds,
    location: form.location,
    startDate: form.startDate,
    endDate: form.endDate
  });

  useEffect(() => {
    if (selectedServiceIds.length === 0 || !form.location || !parsedAccountCount || selectedDuration.days <= 0) {
      setPricing({
        loading: false,
        error: '',
        totalPrice: null,
        basePrice: null,
        duration: 0,
        accounts: 0,
        services: 0
      });
      return undefined;
    }

    let cancelled = false;

    setPricing((current) => ({
      ...current,
      loading: true,
      error: ''
    }));

    calculatePricingEstimate({
      accountCount: parsedAccountCount,
      serviceIds: selectedServiceIds,
      location: form.location,
      startDate: form.startDate,
      endDate: form.endDate,
      selectedInstances: selectedInstancesPayload,
      selectedRoles: selectedRolesPayload
    })
      .then((result) => {
        if (cancelled) {
          return;
        }

        setPricing({
          loading: false,
          error: '',
          basePrice: Number(result.basePrice || 0),
          duration: Number(result.duration || 0),
          accounts: Number(result.accounts || parsedAccountCount),
          services: Array.isArray(result.services) ? result.services.length : selectedCatalogServices.length,
          totalPrice: Number(result.totalPrice || 0)
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setPricing({
          loading: false,
          error: error.message,
          totalPrice: null,
          basePrice: null,
          duration: selectedDuration.days > 0 ? Math.max(1, Math.ceil(selectedDuration.days)) : 0,
          accounts: parsedAccountCount,
          services: selectedCatalogServices.length
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    form.endDate,
    form.location,
    form.startDate,
    parsedAccountCount,
    selectedCatalogServices.length,
    selectedDuration.days,
    selectedInstancesPayload,
    selectedRolesPayload,
    selectedServiceIds
  ]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError('');
    setSubmitDebug('');

    const payload = buildPricingPayload();

    console.log(
      JSON.stringify({
        event: 'request_payload_generated',
        timestamp: new Date().toISOString(),
        payload
      })
    );
    console.log('service_selected', selectedServices);

    if (!Number.isInteger(payload.accountCount) || payload.accountCount <= 0) {
      setSubmitError('Enter valid account count');
      return;
    }

    if (payload.serviceIds.length === 0) {
      setSubmitError(
        selectedServices.length > 0
          ? 'Service unavailable for provisioning'
          : 'Select at least one service before submitting.'
      );
      return;
    }

    if (selectedRolesPayload.length === 0) {
      // Check if any service requires roles
      const requiresRoles = selectedServiceRoleEntries.some(
        (entry) => entry.backendServiceId && entry.roleRequired && entry.enableRoleSelection
      );
      
      if (requiresRoles) {
        setSubmitError('Select at least one role for services that require role selection.');
        return;
      }
    }

    const missingInstance = selectedServiceInstanceEntries.some(
      (entry) => entry.supportsInstances && !entry.selectedInstance
    );

    if (missingInstance) {
      setSubmitError('Select an instance option for each service that supports instances.');
      return;
    }

    if (!form.location) {
      setSubmitError('Select a region for the selected services.');
      return;
    }

    if (!form.customerEmail.trim()) {
      setSubmitError('Customer email is required.');
      return;
    }

    setSubmitting(true);

    try {
      const requestPayload = {
        customerEmail: form.customerEmail.trim(),
        accountCount: payload.accountCount,
        location: form.location,
        startDate: form.startDate,
        endDate: form.endDate,
        serviceIds: payload.serviceIds,
        selectedRoles: selectedRolesPayload,
        selectedInstances: selectedInstancesPayload
      };

      // Add daily usage fields if enabled
      if (form.enableDailyUsage) {
        const dailyLimitHours = Number.parseFloat(form.dailyLimitHours);
        if (!dailyLimitHours || dailyLimitHours <= 0) {
          setSubmitError('Daily usage limit must be a positive number.');
          setSubmitting(false);
          return;
        }

        requestPayload.enableDailyUsage = true;
        requestPayload.dailyLimitMinutes = Math.round(dailyLimitHours * 60);
      }

      const result = await createRequestWithPricing(requestPayload);

      console.log('request_created', result);
      router.push(`/status/${result.requestId}`);
    } catch (error) {
      setSubmitError(error.message);
      if (error?.response) {
        setSubmitDebug(JSON.stringify(error.response, null, 2));
      } else if (error?.payload) {
        setSubmitDebug(JSON.stringify(error.payload, null, 2));
      } else {
        setSubmitDebug(String(error?.message || ''));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="app-shell page-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__eyebrow">Request Builder</span>
          <h1>Create Customer Request</h1>
          <p>
            Choose services first, select the cheapest eligible Azure region, estimate pricing, and launch the
            provisioning flow.
          </p>
        </div>

        <div className="topbar-actions">
          <a className="btn btn--secondary" href="/dashboard">
            Dashboard
          </a>
        </div>
      </header>

      <section className="request-layout">
        <RequestForm
          form={form}
          locations={locations}
          categories={categories}
          services={pricedServices}
          selectedServiceIds={selectedServices}
          selectedServiceRoleEntries={selectedServiceRoleEntries}
          selectedServiceInstanceEntries={selectedServiceInstanceEntries}
          onSelectServiceInstance={(serviceId, instanceOption) => {
            setSubmitError('');
            setSubmitDebug('');
            setSelectedInstancesByServiceId((current) => ({
              ...current,
              [String(serviceId)]: instanceOption
            }));
          }}
          onToggleServiceRole={(serviceId, roleName) => {
            setSubmitError('');
            setSubmitDebug('');
            setSelectedRolesByServiceId((current) => {
              const key = String(serviceId);
              const currentRoles = Array.isArray(current[key]) ? current[key] : [];
              const hasRole = currentRoles.includes(roleName);

              return {
                ...current,
                [key]: hasRole
                  ? currentRoles.filter((role) => role !== roleName)
                  : [...currentRoles, roleName]
              };
            });
          }}
          onFieldChange={updateField}
          onSelectionChange={setSelectedServices}
          onSubmit={handleSubmit}
          submitting={submitting}
          error={submitError}
          loadingServices={locationsLoading || servicesLoading || instancesLoading}
          locationsLoading={locationsLoading}
          locationsError={locationsError}
          servicesError={servicesError}
          instancesLoading={instancesLoading}
          instancesError={instancesError}
          accountCount={parsedAccountCount || 0}
          durationHours={selectedDuration.hours}
        />

        <div className="stack">
            <PricingSummary
              totalPrice={pricing.totalPrice}
              basePrice={pricing.basePrice}
              duration={pricing.duration}
              accounts={pricing.accounts}
            loading={pricing.loading}
            error={pricing.error}
            selectedServiceCount={pricing.services}
            livePrices={livePricingItems}
            livePricingLoading={livePricingLoading}
            livePricingError={livePricingError}
          />

          <RequestTimeline
            title="Flow Preview"
            description="This is the exact sequence that begins after submission."
            events={[
              { title: 'Pricing', message: 'Use the chosen region to calculate the estimated monthly cost from the selected services.' },
              { title: 'Request', message: 'Create the request record and capture the request ID.' },
              { title: 'Provisioning', message: 'Create the resource group, Azure service instances, users, roles, and credentials.' },
              { title: 'Status', message: 'Redirect to the live status page once the request is created.' }
            ]}
          />
        </div>
      </section>

      {submitDebug ? (
        <section className="panel" style={{ marginTop: 20 }}>
          <div className="panel__inner">
            <div className="panel__heading">
              <div>
                <h3>Backend Response</h3>
                <p>Shown when request creation cannot extract the request id.</p>
              </div>
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{submitDebug}</pre>
          </div>
        </section>
      ) : null}
    </main>
  );
}
