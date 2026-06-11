const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const numberFormatter = new Intl.NumberFormat('en-US');

const formatCurrencyWithDigits = (value, currency, maximumFractionDigits) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits
  }).format(Number(value || 0));

export const formatCurrency = (value) => currencyFormatter.format(Number(value || 0));

/** Shows small per-day amounts (e.g. $0.0001) instead of rounding to $0. */
export const formatPreciseCurrency = (value, currency = 'USD') => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return formatCurrencyWithDigits(0, currency, 2);
  }

  if (amount === 0) {
    return formatCurrencyWithDigits(0, currency, 2);
  }

  if (amount < 0.01) {
    return formatCurrencyWithDigits(amount, currency, 6);
  }

  if (amount < 1) {
    return formatCurrencyWithDigits(amount, currency, 4);
  }

  return formatCurrencyWithDigits(amount, currency, 2);
};

export const formatCompactNumber = (value) => numberFormatter.format(Number(value || 0));

export const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  }).format(date);
};

export const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

export const formatRequestStatus = (value) => {
  if (!value) return 'Pending';
  const normalized = String(value)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
};

export const formatStepState = (state) => {
  const value = String(state || 'pending').toLowerCase();
  if (value === 'complete') return 'Complete';
  if (value === 'active') return 'In progress';
  if (value === 'error') return 'Failed';
  return 'Pending';
};

export const statusTone = (value) => {
  const normalized = String(value || '').toLowerCase();
  if (['completed', 'sent', 'complete', 'success'].includes(normalized)) return 'completed';
  if (['processing', 'provisioning', 'in progress', 'pending'].includes(normalized)) return 'provisioning';
  if (['failed', 'expired', 'error'].includes(normalized)) return 'failed';
  return normalized || 'unknown';
};

export const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value || 0)));
