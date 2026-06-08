'use client';

import { useMemo, useState } from 'react';

const formatMoney = (value, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const SearchableMultiSelect = ({
  options = [],
  selectedIds = [],
  onChange,
  placeholder = 'Search Azure services...'
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(true);

  const selectedSet = useMemo(() => new Set(selectedIds.map((value) => String(value))), [selectedIds]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeText(query);

    if (!normalizedQuery) {
      return options;
    }

    return options.filter((option) => {
      const name = normalizeText(option.service_name || option.name);
      const category = normalizeText(option.service_family || option.category);
      return name.includes(normalizedQuery) || category.includes(normalizedQuery);
    });
  }, [options, query]);

  const toggle = (serviceId) => {
    const normalizedId = String(serviceId);
    const next = selectedSet.has(normalizedId)
      ? selectedIds.filter((value) => String(value) !== normalizedId)
      : [...selectedIds, serviceId];

    if (typeof onChange === 'function') {
      onChange(next);
    }
  };

  return (
    <div className="searchable-multi-select">
      <div className="service-dropdown">
        <button
          type="button"
          className="service-dropdown__toggle"
          onClick={() => setIsOpen((value) => !value)}
          aria-expanded={isOpen}
        >
          <div className="service-dropdown__toggle-copy">
            <span className="field__label">Search Azure services</span>
            <strong>Browse and select services</strong>
          </div>
          <div className="service-dropdown__toggle-meta">
            <span className="helper-badge">Selected: {selectedIds.length}</span>
            <span className="service-dropdown__chevron" aria-hidden="true">
              {isOpen ? 'v' : '>'}
            </span>
          </div>
        </button>

        {isOpen ? (
          <div className="service-dropdown__panel">
            <label className="field" style={{ marginBottom: 16 }}>
              <span className="field__label">Search Azure services</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={placeholder}
              />
            </label>

            <div className="topbar-actions" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
              <span className="helper-badge">Selected: {selectedIds.length}</span>
              <span className="inline-note">Hover a service row to reveal pricing and details.</span>
            </div>

            <div className="service-dropdown__list">
              {filteredOptions.length === 0 ? (
                <div className="service-collection__empty">
                  <p>No Azure services match your search.</p>
                </div>
              ) : (
                filteredOptions.map((service) => {
                  const id = String(service.id);
                  const checked = selectedSet.has(id);
                  const name = service.service_name || service.name || 'Unnamed service';
                  const category = service.service_family || service.category || 'General';
                  const currency = service.currency || 'USD';
                  const priceLabel = formatMoney(service.retail_price ?? service.price, currency);
                  const locationCount = Number(service.location_count || 0);
                  const sourceLabel =
                    String(service.pricing_source || '').toLowerCase() === 'azure'
                      ? 'Azure Pricing'
                      : 'Fallback';

                  return (
                    <button
                      key={service.id}
                      type="button"
                      className={`service-card service-card--dropdown${checked ? ' is-selected' : ''}`}
                      onClick={() => toggle(service.id)}
                    >
                      <div className="service-card__header">
                        <div className="topbar-actions" style={{ gap: 10, flexWrap: 'nowrap' }}>
                          <input type="checkbox" checked={checked} readOnly aria-hidden="true" />
                          <strong className="service-card__title">{name}</strong>
                        </div>
                        <span className="helper-badge">{checked ? 'Selected' : 'Available'}</span>
                      </div>

                      <div className="service-card__preview">
                        <p className="service-card__desc">{category}</p>
                        <span className="service-card__hint">Hover for pricing and metadata</span>
                      </div>

                      <div className="service-card__details">
                        <div className="service-card__meta">
                          <span>Category: {category}</span>
                          <strong>
                            {priceLabel} {currency}
                          </strong>
                          <span>{locationCount} regions</span>
                          <span>Source: {sourceLabel}</span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default function ServiceSelector({
  services = [],
  selectedServiceIds = [],
  onSelectionChange,
  loadingServices = false,
  servicesError = '',
  location = ''
}) {
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

  if (!Array.isArray(services) || services.length === 0) {
    return (
      <div className="service-collection__empty">
        <p>No Azure services available for the current selection.</p>
      </div>
    );
  }

  return (
    <div className="service-collection">
      <div className="panel__heading" style={{ marginBottom: 14 }}>
        <div>
          <h3>Services</h3>
          <p>
            {location
              ? `Priced for ${location}`
              : 'Browse Azure services, then hover any row to see price and metadata before selecting.'}
          </p>
        </div>
        <span className="helper-badge">Selected: {selectedServiceIds.length}</span>
      </div>

      <SearchableMultiSelect
        options={services}
        selectedIds={selectedServiceIds}
        onChange={onSelectionChange}
        placeholder="Search Azure services..."
      />
    </div>
  );
}
