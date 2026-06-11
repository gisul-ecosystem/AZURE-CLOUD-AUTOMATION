import { formatCurrency, formatCompactNumber } from '../utils/formatters';

export default function PricingSummary({
  totalPrice,
  basePrice = null,
  duration = 0,
  loading = false,
  error = '',
  accounts = 0,
  selectedServiceCount = 0,
  livePrices = [],
  livePricingLoading = false,
  livePricingError = ''
}) {
  const hasLivePrices = Array.isArray(livePrices) && livePrices.length > 0;

  return (
    <section className="panel pricing-summary">
      <div className="panel__heading">
        <div>
          <h3>Pricing Summary</h3>
          <p>Live estimate from Azure retail pricing based on users, services, instances, roles, region, and dates.</p>
        </div>
        <span className="helper-badge">Calculated in real time</span>
      </div>

      <div className="pricing-summary__price">
        <span className="eyebrow">Final Total</span>
        <strong>
          {loading
            ? 'Calculating...'
            : totalPrice !== null && totalPrice !== undefined
              ? formatCurrency(totalPrice)
              : basePrice !== null && basePrice !== undefined && duration > 0 && accounts > 0
                ? formatCurrency(Number(basePrice) * Number(duration) * Number(accounts))
              : '-'}
        </strong>
        <span className="inline-note">
          Formula: daily service cost x duration x accounts. Includes Azure infrastructure, instance tiers, and portal fees.
        </span>
      </div>

      <div className="pricing-summary__meta">
        <div className="meta-pill">
          <span>Base Price</span>
          <strong>{basePrice !== null && basePrice !== undefined ? formatCurrency(basePrice) : '-'}</strong>
        </div>
        <div className="meta-pill">
          <span>Duration</span>
          <strong>{duration > 0 ? `${formatCompactNumber(duration)} day${duration === 1 ? '' : 's'}` : '-'}</strong>
        </div>
        <div className="meta-pill">
          <span>Accounts</span>
          <strong>{formatCompactNumber(accounts)}</strong>
        </div>
        <div className="meta-pill">
          <span>Services</span>
          <strong>{formatCompactNumber(selectedServiceCount)}</strong>
        </div>
        <div className="meta-pill">
          <span>Status</span>
          <strong>{error ? 'Error' : loading ? 'Loading' : 'Ready'}</strong>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel__heading" style={{ marginBottom: 12 }}>
          <div>
            <h4 style={{ marginBottom: 4 }}>Live Azure Retail Billing</h4>
            <p>
              {livePricingLoading
                ? 'Fetching latest Azure pricing...'
                : 'Current retail prices update as service, region, or instance selections change.'}
            </p>
          </div>
          <span className="helper-badge">{livePricingLoading ? 'Refreshing' : 'Cached for 30m'}</span>
        </div>

        {livePricingError ? <div className="error-box">{livePricingError}</div> : null}

        {livePricingLoading ? <div className="inline-note">Fetching latest Azure pricing...</div> : null}

        {!livePricingLoading && !hasLivePrices ? (
          <div className="service-collection__empty">
            <p>Select a service, region, and instance to view live Azure Retail pricing.</p>
          </div>
        ) : null}

        {hasLivePrices ? (
          <div className="pricing-summary__live-list">
            {livePrices.map((item) => (
              <div key={item.key} className="meta-pill" style={{ alignItems: 'flex-start', gap: 6 }}>
                <span>{item.name}</span>
                <strong>{item.displayPrice || item.message || 'Pricing unavailable'}</strong>
                <span className="inline-note">
                  {item.unit ? `Azure unit: ${item.unit}` : 'Azure unit unavailable'}
                </span>
                <span className="inline-note">
                  {item.region ? `Region: ${item.region}` : ''}
                  {item.sku ? `${item.region ? ' · ' : ''}SKU: ${item.sku}` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {error ? <div className="error-box">{error}</div> : null}
    </section>
  );
}
