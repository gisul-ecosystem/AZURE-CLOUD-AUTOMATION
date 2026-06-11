'use client';

import { formatPreciseCurrency } from '../utils/formatters';

export default function InstanceSelector({
  instances = [],
  selectedInstance = '',
  onSelect,
  disabled = false,
  loading = false,
  location = '',
  resolveInstanceRole
}) {
  if (loading) {
    return <p className="inline-note">Loading sizes available in this region...</p>;
  }

  if (!instances.length) {
    return <p className="inline-note">No instance options are available for this region.</p>;
  }

  return (
    <div className="instance-selector">
      <div className="topbar-actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="helper-badge">
          {selectedInstance ? '1 selected' : 'None selected'}
        </span>
        <span className="inline-note">Hover an instance to see specs, guide, and price.</span>
      </div>

      <div className="instance-selector__list">
        {instances.map((instance) => {
          const optionName = instance.option_name;
          const isSelected = selectedInstance === optionName;
          const guide = instance.guide || {};
          const mappedRole = resolveInstanceRole?.(optionName);
          const hasPrice = Number.isFinite(Number(instance.dailyPrice)) && Number(instance.dailyPrice) >= 0;
          const currency = instance.currency || 'USD';
          const priceRegion = instance.priceRegion || location || 'eastus';
          const priceIsEstimate = instance.priceIsEstimate ?? !location;

          return (
            <button
              key={instance.id || optionName}
              type="button"
              className={`service-card service-card--dropdown instance-card${isSelected ? ' is-selected' : ''}`}
              disabled={disabled}
              onClick={() => onSelect?.(optionName)}
            >
              <div className="service-card__header">
                <div className="topbar-actions" style={{ gap: 10, flexWrap: 'nowrap' }}>
                  <input type="radio" checked={isSelected} readOnly aria-hidden="true" />
                  <strong className="service-card__title">{optionName}</strong>
                </div>
                <span className="helper-badge">{isSelected ? 'Selected' : guide.tier || 'Option'}</span>
              </div>

              <div className="service-card__preview">
                <p className="service-card__desc">{guide.summary || 'Azure instance option'}</p>
                <span className="service-card__hint">Hover for details</span>
              </div>

              <div className="service-card__details">
                <div className="service-card__meta">
                  {guide.description ? <span>{guide.description}</span> : null}
                  {guide.specs?.length
                    ? guide.specs.map((spec) => (
                        <span key={`${optionName}-${spec.label}`}>
                          {spec.label}: {spec.value}
                        </span>
                      ))
                    : null}
                  {mappedRole ? <span>Auto role: {mappedRole}</span> : null}
                  {hasPrice ? (
                    <strong>
                      {priceIsEstimate ? 'Est. ' : ''}
                      {formatPreciseCurrency(instance.dailyPrice, currency)}/day in {priceRegion}
                    </strong>
                  ) : (
                    <span>Price unavailable for this region</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
