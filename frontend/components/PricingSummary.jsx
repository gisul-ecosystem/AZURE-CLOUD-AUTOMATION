import { formatCurrency, formatCompactNumber } from '../utils/formatters';

export default function PricingSummary({
  totalPrice,
  basePrice = null,
  duration = 0,
  loading = false,
  error = '',
  accounts = 0,
  selectedServiceCount = 0
}) {
  return (
    <section className="panel pricing-summary">
      <div className="panel__heading">
        <div>
          <h3>Pricing Summary</h3>
          <p>Live estimate updates as the account count and selected services change.</p>
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
          Pricing is based on {formatCompactNumber(selectedServiceCount)} selected service
          {selectedServiceCount === 1 ? '' : 's'}, {formatCompactNumber(accounts)} account
          {accounts === 1 ? '' : 's'}, and the selected date range.
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

      {error ? <div className="error-box">{error}</div> : null}
    </section>
  );
}
