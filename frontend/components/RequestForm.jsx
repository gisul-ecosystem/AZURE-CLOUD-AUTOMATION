'use client';

import ServiceSelector from './ServiceSelector';
import InstanceSelector from './InstanceSelector';
import WeeklyUsageSchedule from './WeeklyUsageSchedule';
import { formatPreciseCurrency } from '../utils/formatters';

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
  onRequestAdminAccess,
  adminAccessRequestState = {},
  onFieldChange,
  onUsageScheduleChange,
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
              <p>Set weekly access windows and per-day usage limits for provisioned Azure access.</p>
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

            {form.enableDailyUsage && form.usageSchedule ? (
              <WeeklyUsageSchedule
                schedule={form.usageSchedule}
                onChange={onUsageScheduleChange}
                disabled={submitting}
              />
            ) : null}
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

                    <InstanceSelector
                      instances={entry.availableInstances}
                      selectedInstance={entry.selectedInstance || ''}
                      onSelect={(optionName) =>
                        onSelectServiceInstance?.(entry.backendServiceId, optionName)
                      }
                      disabled={instancesLoading || entry.availableInstances.length === 0}
                      loading={instancesLoading}
                      location={form.location}
                      resolveInstanceRole={entry.resolveInstanceRole}
                    />
                  </div>
                ))}
            </div>
          </div>
        ) : null}

        {selectedServiceRoleEntries.length > 0 ? (
          <div className="surface" style={{ padding: 16 }}>
            <div className="panel__heading" style={{ marginBottom: 14 }}>
              <div>
                <h3>Permissions</h3>
                <p>Basic permissions are included automatically. Request admin access if you need elevated roles.</p>
              </div>
              <span className="helper-badge">
                {selectedServiceRoleEntries.filter((entry) => entry.defaultRole || entry.tierAutomatedRole).length} included
              </span>
            </div>

            <div className="step-stack">
              {selectedServiceRoleEntries.map((entry) => {
                const assignedRole = entry.tierAutomated
                  ? entry.tierAutomatedRole
                  : entry.defaultRole;
                const elevatedRoles = entry.availableRoles.filter(
                  (role) => role.azure_role !== assignedRole
                );
                const requestKey = String(entry.backendServiceId);
                const requestState = adminAccessRequestState[requestKey] || {};

                return (
                  <div key={entry.backendServiceId || entry.catalogServiceId} className="surface" style={{ padding: 16 }}>
                    <div className="panel__heading" style={{ marginBottom: 12 }}>
                      <div>
                        <h4 style={{ marginBottom: 4 }}>{entry.name}</h4>
                        <p>Included permissions for this service</p>
                      </div>
                      <span className="helper-badge">Auto-assigned</span>
                    </div>

                    {entry.loading ? (
                      <p className="inline-note">Loading permission mappings...</p>
                    ) : !entry.backendServiceId ? (
                      <p className="inline-note">This selected service does not map to a provisionable backend service.</p>
                    ) : (
                      <>
                        {assignedRole ? (
                          <div className="permission-highlight">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <span style={{ fontSize: '1.2em' }}>✓</span>
                              <strong>{assignedRole}</strong>
                              <span className="helper-badge">Included</span>
                            </div>
                            <p className="inline-note" style={{ margin: 0 }}>
                              {entry.tierAutomated
                                ? `Automatically assigned from the selected instance tier${entry.selectedInstance ? ` (${entry.selectedInstance})` : ''}.`
                                : 'This basic permission is automatically assigned to all users during provisioning.'}
                            </p>
                          </div>
                        ) : (
                          <p className="inline-note" style={{ marginBottom: 12 }}>
                            No default permission configured for this service.
                          </p>
                        )}

                        {entry.availableRoles.length > 0 ? (
                          <div style={{ marginBottom: elevatedRoles.length > 0 ? 16 : 0 }}>
                            <p className="field__label" style={{ marginBottom: 8 }}>
                              Available permissions for this service
                            </p>
                            <div className="step-stack" style={{ gap: 8 }}>
                              {entry.availableRoles.map((role) => {
                                const isIncluded = role.azure_role === assignedRole;

                                return (
                                  <div
                                    key={role.id}
                                    className={`permission-row${isIncluded ? ' permission-row--included' : ''}`}
                                  >
                                    <span>{role.azure_role}</span>
                                    <span className="helper-badge">
                                      {isIncluded ? 'Included' : 'Admin — request required'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}

                        {elevatedRoles.length > 0 ? (
                          <div className="permission-request-panel">
                            <p className="field__label" style={{ marginBottom: 8 }}>
                              Need admin access?
                            </p>
                            <p className="inline-note" style={{ marginBottom: 10 }}>
                              Describe the elevated permissions you need. Your request will be sent to the organization admin for review.
                            </p>
                            <label className="field">
                              <span className="field__label">Requested access</span>
                              <textarea
                                rows={3}
                                value={requestState.draft || ''}
                                onChange={(event) =>
                                  onRequestAdminAccess?.(entry.backendServiceId, {
                                    type: 'draft',
                                    value: event.target.value
                                  })
                                }
                                placeholder={`e.g. ${elevatedRoles.map((role) => role.azure_role).slice(0, 2).join(', ')}`}
                                disabled={requestState.submitting || requestState.submitted}
                              />
                            </label>
                            {requestState.error ? (
                              <div className="error-box" style={{ marginTop: 10 }}>
                                {requestState.error}
                              </div>
                            ) : null}
                            {requestState.success ? (
                              <div className="success-box" style={{ marginTop: 10 }}>
                                {requestState.success}
                              </div>
                            ) : null}
                            <div className="button-row" style={{ marginTop: 12 }}>
                              <button
                                type="button"
                                className="btn btn--secondary"
                                disabled={requestState.submitting || requestState.submitted}
                                onClick={() =>
                                  onRequestAdminAccess?.(entry.backendServiceId, {
                                    type: 'submit',
                                    serviceName: entry.name,
                                    defaultRole: assignedRole,
                                    elevatedRoles: elevatedRoles.map((role) => role.azure_role)
                                  })
                                }
                              >
                                {requestState.submitting
                                  ? 'Submitting...'
                                  : requestState.submitted
                                    ? 'Request Submitted'
                                    : 'Request Admin Access'}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                );
              })}
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
                        {getRegionRankLabel(index)} {label} ({formatPreciseCurrency(region.basePrice, region.currency)}/day)
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
