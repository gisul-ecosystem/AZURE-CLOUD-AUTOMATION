'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PricingSummary from './PricingSummary';
import RequestForm from './RequestForm';
import RequestTimeline from './RequestTimeline';
import { createRequestWithPricing } from '../services/api';
import useLocations from '../hooks/useLocations';
import useServicePricing from '../hooks/useServicePricing';

const getInitialExpiry = () => {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
};

const getTodayDate = () => new Date().toISOString().slice(0, 10);

const getDatePlusDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const getPositiveInteger = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export default function RequestWorkspace() {
  const router = useRouter();
  const [selectedServices, setSelectedServices] = useState([]);
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
    startDate: getTodayDate(),
    endDate: getDatePlusDays(30),
    expiryDate: getInitialExpiry()
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

  const selectedDuration = useMemo(() => {
    if (!form.startDate || !form.endDate) {
      return { hours: 0, days: 0 };
    }

    const start = Date.parse(`${form.startDate}T00:00:00.000Z`);
    const end = Date.parse(`${form.endDate}T00:00:00.000Z`);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return { hours: 0, days: 0 };
    }

    const hours = (end - start) / 3600000;

    return {
      hours,
      days: hours / 24
    };
  }, [form.startDate, form.endDate]);

  const selectedCatalogServices = useMemo(() => {
    const selectedIds = new Set(selectedServices.map((id) => String(id)));
    return pricedServices.filter((service) => selectedIds.has(String(service.id)));
  }, [pricedServices, selectedServices]);

  const selectedServicesForProvisioning = useMemo(
    () => selectedCatalogServices.filter((service) => Boolean(service.azure_role)),
    [selectedCatalogServices]
  );

  const provisionServiceIds = useMemo(
    () =>
      selectedServicesForProvisioning
        .map((service) => Number(service.id))
        .filter((value) => Number.isInteger(value) && value > 0),
    [selectedServicesForProvisioning]
  );

  const updateField = (event) => {
    const { name, value } = event.target;
    setSubmitError('');
    setSubmitDebug('');
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

    if (!form.location) {
      setSubmitError('Select a region for the selected services.');
      return;
    }

    if (!form.customerEmail.trim()) {
      setSubmitError('Customer email is required.');
      return;
    }

    if (!form.expiryDate) {
      setSubmitError('Expiry date is required.');
      return;
    }

    setSubmitting(true);

    try {
      const result = await createRequestWithPricing({
        customerEmail: form.customerEmail.trim(),
        accountCount: payload.accountCount,
        location: form.location,
        startDate: form.startDate,
        endDate: form.endDate,
        expiryDate: form.expiryDate,
        serviceIds: payload.serviceIds,
        provisionServiceIds
      });

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
