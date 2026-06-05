'use client';

import { useEffect, useState } from 'react';

const formatMoney = (value, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const ServiceCard = ({ service, selectedServices, toggleService }) => {
  const normalizedId = String(service.id);
  const checked = selectedServices.includes(normalizedId);
  const priceLabel = formatMoney(service.price, service.currency);

  console.log({
    selectedServices,
    current: service.id
  });

  return (
    <div
      role="button"
      tabIndex={0}
      className="service-card"
      onClick={() => toggleService(service.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleService(service.id);
        }
      }}
      style={
        checked
          ? {
              border: '2px solid #37d0ff'
            }
          : undefined
      }
    >
      <div className="topbar-actions" style={{ justifyContent: 'space-between' }}>
        <div className="topbar-actions" style={{ gap: 10 }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleService(service.id)}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Toggle ${service.name}`}
          />
          <strong className="service-card__title">{service.name}</strong>
        </div>
        <span className="helper-badge">{service.azure_role ? 'Provision Supported' : 'Catalog Only'}</span>
      </div>
      <p className="service-card__desc">{service.azure_role || 'Azure role not mapped'}</p>
      <div className="service-card__meta" style={{ display: 'grid', gap: 4 }}>
        <span>{service.location || 'Available in selected region'}</span>
        <span>Available in selected region</span>
        <strong>{priceLabel}</strong>
        {checked ? <span>Selected</span> : null}
      </div>
    </div>
  );
};

export default function ServiceSelector({
  serviceGroups = [],
  selectedServiceIds = [],
  onSelectionChange,
  loadingServices = false,
  servicesError = '',
  location = ''
}) {
  const [selectedServices, setSelectedServices] = useState([]);

  useEffect(() => {
    setSelectedServices(selectedServiceIds.map((value) => String(value)));
  }, [selectedServiceIds]);

  const toggleService = (id) => {
    const serviceId = String(id);

    setSelectedServices((prev) => {
      const next = prev.includes(serviceId) ? prev.filter((x) => x !== serviceId) : [...prev, serviceId];
      if (typeof onSelectionChange === 'function') {
        onSelectionChange(next);
      }
      return next;
    });
  };

  if (servicesError) {
    return <div className="error-box">Service unavailable for provisioning</div>;
  }

  if (loadingServices) {
    return (
      <div className="service-collection__empty">
        <p>Loading Azure Services...</p>
      </div>
    );
  }

  if (serviceGroups.length === 0) {
    return (
      <div className="service-collection__empty">
        <p>No Azure services available in this region.</p>
      </div>
    );
  }

  return (
    <div className="service-collection">
      <div className="panel__heading" style={{ marginBottom: 14 }}>
        <div>
          <h3>Services</h3>
          <p>{location ? `Available in selected region: ${location}` : 'Available in selected region'}</p>
        </div>
        <span className="helper-badge">Services: {selectedServices.length}</span>
      </div>

      {serviceGroups.map((group) => (
        <section className="service-group" key={group.key}>
          <div className="service-group__header">
            <div>
              <h3>{group.label}</h3>
              <p>{group.services.length} available services</p>
            </div>
            <span className="helper-badge">{group.services.length}</span>
          </div>

          <div className="service-grid">
            {group.services.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                selectedServices={selectedServices}
                toggleService={toggleService}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
