'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PricingSummary from './PricingSummary';
import RequestForm from './RequestForm';
import RequestTimeline from './RequestTimeline';
import { createRequestWithPricing, getServiceRoles, getServices } from '../services/api';
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

const normalizeServiceName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^azure\s+/, '');

export default function RequestWorkspace() {
  const router = useRouter();
  const [selectedServices, setSelectedServices] = useState([]);
  const [provisionableServices, setProvisionableServices] = useState([]);
  const [provisionableServicesLoading, setProvisionableServicesLoading] = useState(true);
  const [serviceRolesByServiceId, setServiceRolesByServiceId] = useState({});
  const [selectedRolesByServiceId, setSelectedRolesByServiceId] = useState({});
  const selectedServiceIds = useMemo(
    () =>
      selectedServices
        .map((id) => Number(id))
        .filter((value) => Number.isInteger(value) && value > 0),
    [selectedServices]
  );
  const { locations, loading: locationsLoading, error: locationsError } = useLocations(selectedServiceIds);
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
    loading: servicesLoading,
    error: servicesError
  } = useServicePricing();

  useEffect(() => {
    let cancelled = false;

    const loadProvisionableServices = async () => {
      setProvisionableServicesLoading(true);

      try {
        const nextServices = await getServices();

        if (!cancelled) {
          setProvisionableServices(Array.isArray(nextServices) ? nextServices : []);
        }
      } catch (error) {
        if (!cancelled) {
          setProvisionableServices([]);
        }
      } finally {
        if (!cancelled) {
          setProvisionableServicesLoading(false);
        }
      }
    };

    loadProvisionableServices();

    return () => {
      cancelled = true;
    };
  }, []);

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

  const selectedServiceRoleEntries = useMemo(() => {
    return selectedCatalogServices.map((catalogService) => {
      const matchedService = provisionableServices.find(
        (service) => normalizeServiceName(service.name) === normalizeServiceName(catalogService.name)
      );
      const backendServiceId = matchedService ? Number(matchedService.id) : null;
      const availableRoles = backendServiceId ? serviceRolesByServiceId[backendServiceId] || [] : [];
      const selectedRoles = backendServiceId ? selectedRolesByServiceId[backendServiceId] || [] : [];
      
      // Get service configuration for role selection
      const enableRoleSelection = matchedService?.enable_role_selection !== false; // default true
      const defaultRole = matchedService?.default_role || null;
      const roleRequired = matchedService?.role_required !== false; // default true

      return {
        catalogServiceId: Number(catalogService.id),
        name: catalogService.name || catalogService.service_name || 'Unnamed service',
        backendServiceId,
        availableRoles,
        selectedRoles,
        enableRoleSelection,
        defaultRole,
        roleRequired,
        loading:
          provisionableServicesLoading ||
          (backendServiceId ? serviceRolesByServiceId[backendServiceId] === undefined : false)
      };
    });
  }, [
    provisionableServices,
    provisionableServicesLoading,
    pricedServices,
    selectedCatalogServices,
    selectedRolesByServiceId,
    serviceRolesByServiceId
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
    let cancelled = false;

    const loadServiceRoles = async () => {
      const missingEntries = selectedServiceRoleEntries.filter(
        (entry) => entry.backendServiceId && serviceRolesByServiceId[entry.backendServiceId] === undefined
      );

      if (missingEntries.length === 0) {
        return;
      }

      const nextRoles = {};

      await Promise.all(
        missingEntries.map(async (entry) => {
          try {
            const roles = await getServiceRoles(entry.backendServiceId);

            if (!cancelled) {
              nextRoles[entry.backendServiceId] = Array.isArray(roles) ? roles : [];
            }
          } catch (error) {
            if (!cancelled) {
              nextRoles[entry.backendServiceId] = [];
            }
          }
        })
      );

      if (!cancelled && Object.keys(nextRoles).length > 0) {
        setServiceRolesByServiceId((current) => ({
          ...current,
          ...nextRoles
        }));
      }
    };

    loadServiceRoles();

    return () => {
      cancelled = true;
    };
  }, [selectedServiceRoleEntries, serviceRolesByServiceId]);

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
    if (selectedServiceIds.length === 0 || !form.location) {
      setPricing({
        loading: false,
        error: '',
        totalPrice: null,
        basePrice: null,
        duration: 0,
        accounts: 0,
        services: 0
      });
      return;
    }

    if (servicesLoading) {
      setPricing({
        loading: true,
        error: '',
        totalPrice: null,
        basePrice: null,
        duration: selectedDuration.days,
        accounts: Number(parsedAccountCount || 1),
        services: selectedCatalogServices.length
      });
      return;
    }

    const selected = pricedServices.filter((service) => selectedServices.includes(String(service.id)));
    const basePrice = selected.reduce((sum, service) => sum + Number(service.retail_price || service.price || 0), 0);
    const duration = selectedDuration.days > 0 ? Math.max(1, Math.ceil(selectedDuration.days)) : 0;
    const accounts = Number(parsedAccountCount || 1);
    const total = basePrice * duration * accounts;

    setPricing({
      loading: false,
      error: '',
      basePrice,
      duration,
      accounts,
      services: selected.length,
      totalPrice: Number(total.toFixed(2))
    });
  }, [
    selectedServices,
    selectedServiceIds.length,
    parsedAccountCount,
    form.location,
    selectedDuration.days,
    pricedServices,
    servicesLoading,
    selectedCatalogServices.length
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
        selectedRoles: selectedRolesPayload
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
          services={pricedServices}
          selectedServiceIds={selectedServices}
          selectedServiceRoleEntries={selectedServiceRoleEntries}
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
          loadingServices={locationsLoading || servicesLoading}
          locationsLoading={locationsLoading}
          locationsError={locationsError}
          servicesError={servicesError}
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
          />

          <RequestTimeline
            title="Flow Preview"
            description="This is the exact sequence that begins after submission."
            events={[
              { title: 'Pricing', message: 'Use the chosen region to calculate the estimated monthly cost from the selected services.' },
              { title: 'Request', message: 'Create the request record and capture the request ID.' },
              { title: 'Provisioning', message: 'Create the resource group, users, roles, and credentials.' },
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
