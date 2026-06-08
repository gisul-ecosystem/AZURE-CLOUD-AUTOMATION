'use client';

import ServiceSelector from './ServiceSelector';

const formatMoney = (value) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const getRegionRankLabel = (index) => {
  if (index === 0) {
    return '\u{1F947} Cheapest';
  }

  if (index === 1) {
    return '\u{1F948} Mid';
  }

  return '\u{1F949} Expensive';
};

export default function RequestForm({
  form,
  locations = [],
  serviceGroups = [],
  services = [],
  selectedServiceIds = [],
  onFieldChange,
  onSelectionChange,
  onSubmit,
  submitting = false,
  error = '',
  loadingServices = false,
  locationsLoading = false,
  locationsError = '',
  servicesError = '',
  accountCount = 0,
  durationHours = 0,
  submitLabel = 'Create Request'
}) {
  return (
    <section className="panel request-form">
      <div className="panel__heading">
        <div>
          <span className="brand__eyebrow">Request Builder</span>
          <h2>Create Access Request</h2>
        </div>
        <p className="section-copy">
          Capture the customer details, choose services first, then pick the best Azure region before the
          backend orchestration begins.
        </p>
      </div>

      <form onSubmit={onSubmit} className="step-stack">
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Customer Email</span>
            <input
              type="email"
              name="customerEmail"
              value={form.customerEmail}
              onChange={onFieldChange}
              placeholder="customer@company.com"
              required
            />
          </label>

          <label className="field">
            <span className="field__label">Account Count</span>
            <input
              type="number"
              name="accountCount"
              min="1"
              step="1"
              value={form.accountCount}
              onChange={onFieldChange}
              placeholder="10"
              required
            />
          </label>

          <label className="field">
            <span className="field__label">Service Start Date and Time</span>
            <input
              type="datetime-local"
              name="startDate"
              value={form.startDate}
              step="60"
              onChange={onFieldChange}
              required
            />
          </label>

          <label className="field">
            <span className="field__label">Service End Date and Time</span>
            <input
              type="datetime-local"
              name="endDate"
              value={form.endDate}
              step="60"
              onChange={onFieldChange}
              required
            />
          </label>
        </div>

        <div className="surface" style={{ padding: 16 }}>
          <div className="panel__heading" style={{ marginBottom: 14 }}>
            <div>
              <h3>Services</h3>
              <p>Selected services: {selectedServiceIds.length}</p>
            </div>
            <span className="helper-badge">Multi-select</span>
          </div>

          <ServiceSelector
            serviceGroups={serviceGroups}
            services={services}
            selectedServiceIds={selectedServiceIds}
            onSelectionChange={onSelectionChange}
            loadingServices={loadingServices}
            servicesError={servicesError}
            accountCount={accountCount}
            durationHours={durationHours}
            location={form.location}
          />
          <p className="inline-note" style={{ marginTop: 12 }}>
            Some services may not support automated provisioning.
          </p>
        </div>

        {selectedServiceIds.length > 0 ? (
          <div className="surface" style={{ padding: 16 }}>
            <div className="panel__heading" style={{ marginBottom: 14 }}>
              <div>
                <h3>Available Regions</h3>
                <p>Loaded only after the selected services are validated against each region.</p>
              </div>
              <span className="helper-badge">
                {locations.length > 0 ? `${locations.length} matches` : locationsLoading ? 'Loading' : 'No matches'}
              </span>
            </div>

            <label className="field">
              <span className="field__label">Azure Region</span>
              <select
                name="location"
                value={form.location}
                onChange={onFieldChange}
                required
                disabled={locationsLoading || locations.length === 0}
              >
                {locations.length === 0 ? (
                  <option value="">{locationsLoading ? 'Loading regions...' : 'No matching regions'}</option>
                ) : (
                  locations.map((region, index) => {
                    const label = region.display_location || region.label || region.arm_region_name || region.value;
                    return (
                      <option key={region.arm_region_name || region.value} value={region.arm_region_name || region.value}>
                        {getRegionRankLabel(index)} {label} ({formatMoney(region.basePrice, region.currency)})
                      </option>
                    );
                  })
                )}
              </select>
              {locationsError ? <span className="inline-note">{locationsError}</span> : null}
              <span className="inline-note">
                Regions are sorted by the lowest combined price for the selected services.
              </span>
            </label>
          </div>
        ) : null}

        {error ? <div className="error-box">{error}</div> : null}

        <div className="button-row">
          <button className="btn btn--primary" type="submit" disabled={submitting}>
            {submitting ? 'Creating Request...' : submitLabel}
          </button>
          <span className="inline-note">
            The backend will calculate pricing, create the request, and move the workflow to the
            status page.
          </span>
        </div>
      </form>
    </section>
  );
}
