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
  categories = [],
  services = [],
  selectedServiceIds = [],
  selectedServiceRoleEntries = [],
  selectedServiceInstanceEntries = [],
  onSelectServiceInstance,
  onToggleServiceRole,
  onFieldChange,
  onSelectionChange,
  onSubmit,
  submitting = false,
  error = '',
  loadingServices = false,
  locationsLoading = false,
  locationsError = '',
  servicesError = '',
  instancesLoading = false,
  instancesError = '',
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

        <div className="surface" style={{ padding: 16, marginTop: 16 }}>
          <div className="panel__heading" style={{ marginBottom: 14 }}>
            <div>
              <h3>Daily Usage Limits</h3>
              <p>Configure optional daily usage restrictions for provisioned access.</p>
            </div>
          </div>

          <div className="form-grid">
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <input
                type="checkbox"
                name="enableDailyUsage"
                checked={form.enableDailyUsage || false}
                onChange={(e) => onFieldChange({ target: { name: 'enableDailyUsage', value: e.target.checked } })}
              />
              <span className="field__label" style={{ margin: 0 }}>
                Enable Daily Usage Limit
              </span>
            </label>

            {form.enableDailyUsage && (
              <label className="field">
                <span className="field__label">Daily Usage Limit (hours)</span>
                <input
                  type="number"
                  name="dailyLimitHours"
                  min="0.5"
                  step="0.5"
                  value={form.dailyLimitHours || ''}
                  onChange={onFieldChange}
                  placeholder="2"
                  required={form.enableDailyUsage}
                />
                <span className="inline-note">
                  Users can access provisioned resources for this many hours per day during the service period.
                </span>
              </label>
            )}
          </div>
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
            categories={categories}
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
            Users receive permission to create resources in the resource group, constrained by the selected instance policies.
          </p>
        </div>

        {selectedServiceInstanceEntries.some((entry) => entry.supportsInstances) ? (
          <div className="surface" style={{ padding: 16 }}>
            <div className="panel__heading" style={{ marginBottom: 14 }}>
              <div>
                <h3>Instances</h3>
                <p>
                  Select the size, tier, or plan users are allowed to create for each Azure service.
                  {form.location
                    ? ` Regions are loaded from Azure for your subscription.`
                    : ''}
                </p>
              </div>
              <span className="helper-badge">
                {selectedServiceInstanceEntries.filter((entry) => entry.selectedInstance).length} selected
              </span>
            </div>

            {instancesError ? (
              <p className="inline-note" style={{ marginBottom: 12 }}>
                Could not verify regional instance availability. Showing catalog options instead.
              </p>
            ) : null}

            <div className="step-stack">
              {selectedServiceInstanceEntries
                .filter((entry) => entry.supportsInstances)
                .map((entry) => (
                  <div key={entry.backendServiceId} className="surface" style={{ padding: 16 }}>
                    <div className="panel__heading" style={{ marginBottom: 12 }}>
                      <div>
                        <h4 style={{ marginBottom: 4 }}>{entry.name}</h4>
                        <p>
                          {instancesLoading
                            ? 'Loading sizes available in this region...'
                            : entry.availableInstances.length === 0
                              ? 'No instance options are available for this region.'
                              : 'Choose an instance option'}
                        </p>
                      </div>
                    </div>

                    <label className="field">
                      <span className="field__label">Instance option</span>
                      <select
                        value={entry.selectedInstance || ''}
                        onChange={(event) =>
                          onSelectServiceInstance?.(entry.backendServiceId, event.target.value)
                        }
                        required
                        disabled={instancesLoading || entry.availableInstances.length === 0}
                      >
                        <option value="">
                          {instancesLoading ? 'Loading...' : 'Select instance...'}
                        </option>
                        {entry.availableInstances.map((instance) => {
                          const mappedRole = entry.resolveInstanceRole?.(instance.option_name);

                          return (
                            <option key={instance.id} value={instance.option_name}>
                              {mappedRole
                                ? `${instance.option_name} → ${mappedRole}`
                                : instance.option_name}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  </div>
                ))}
            </div>
          </div>
        ) : null}

        {selectedServiceRoleEntries.length > 0 ? (
          <div className="surface" style={{ padding: 16 }}>
            <div className="panel__heading" style={{ marginBottom: 14 }}>
              <div>
                <h3>Roles</h3>
                <p>Select Azure RBAC roles for each service or view auto-assigned default roles.</p>
              </div>
              <span className="helper-badge">
                {selectedServiceRoleEntries.reduce((count, entry) => {
                  if (!entry.enableRoleSelection && entry.defaultRole) {
                    return count + 1; // Count auto-assigned
                  }
                  return count + entry.selectedRoles.length; // Count manual
                }, 0)} assigned
              </span>
            </div>

            <div className="step-stack">
              {selectedServiceRoleEntries.map((entry) => (
                <div key={entry.backendServiceId || entry.catalogServiceId} className="surface" style={{ padding: 16 }}>
                  <div className="panel__heading" style={{ marginBottom: 12 }}>
                    <div>
                      <h4 style={{ marginBottom: 4 }}>{entry.name}</h4>
                      <p>Selected service</p>
                    </div>
                    {entry.enableRoleSelection ? (
                      <span className="helper-badge">
                        {entry.selectedRoles.length > 0 ? `${entry.selectedRoles.length} selected` : 
                         entry.roleRequired ? 'Required' : 'Optional'}
                      </span>
                    ) : (
                      <span className="helper-badge">Auto-assigned</span>
                    )}
                  </div>

                  {entry.loading ? (
                    <p className="inline-note">Loading role mappings...</p>
                  ) : !entry.backendServiceId ? (
                    <p className="inline-note">This selected service does not map to a provisionable backend service.</p>
                    ) : !entry.enableRoleSelection ? (
                    // Auto-assigned default or tier-driven role
                    <div className="surface" style={{ padding: 12, backgroundColor: '#f0f9ff', border: '1px solid #0ea5e9' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: '1.2em' }}>✓</span>
                        <strong>{entry.defaultRole || 'Default role'}</strong>
                      </div>
                      <p className="inline-note" style={{ margin: 0 }}>
                        {entry.tierAutomated
                          ? `Role is automatically assigned from the selected instance tier${entry.selectedInstance ? ` (${entry.selectedInstance})` : ''}. Azure Policy enforces the matching capacity mode.`
                          : 'This role will be automatically assigned during provisioning.'}
                      </p>
                    </div>
                  ) : entry.availableRoles.length > 0 ? (
                    // Manual role selection
                    <div className="step-stack" style={{ gap: 10 }}>
                      {entry.availableRoles.map((role) => {
                        const checked = entry.selectedRoles.includes(role.azure_role);

                        return (
                          <label key={role.id} className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => onToggleServiceRole?.(entry.backendServiceId, role.azure_role)}
                            />
                            <span className="field__label" style={{ margin: 0 }}>
                              {role.azure_role}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="inline-note">
                      {entry.roleRequired 
                        ? 'No role mappings configured for this service.' 
                        : 'No role mappings configured. Roles are optional for this service.'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}

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
                        {getRegionRankLabel(index)} {label} ({formatMoney(region.basePrice)}/day)
                      </option>
                    );
                  })
                )}
              </select>
              {locationsError ? <span className="inline-note">{locationsError}</span> : null}
              <span className="inline-note">
                Daily Azure retail estimate for the selected services and instance sizes. Final total also includes users and date range.
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
