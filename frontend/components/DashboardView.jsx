import Link from 'next/link';
import { formatCompactNumber, formatCurrency, formatDateTime, statusTone } from '../utils/formatters';

const metricCards = [
  { key: 'total', label: 'Total Requests' },
  { key: 'completed', label: 'Completed' },
  { key: 'provisioning', label: 'Provisioning' },
  { key: 'expired', label: 'Expired' }
];

const EmptyRequestState = () => (
  <div className="timeline-item">
    <strong>No requests yet</strong>
    <span className="timeline-item__meta">
      Create the first provisioning request to populate the dashboard.
    </span>
  </div>
);

export default function DashboardView({ requests = [], error = '', lastUpdated = null }) {
  const normalizedRequests = Array.isArray(requests) ? requests : [];

  const stats = normalizedRequests.reduce(
    (acc, request) => {
      acc.total += 1;

      const status = String(request?.status || '').toLowerCase();
      if (status === 'completed') acc.completed += 1;
      else if (status === 'expired') acc.expired += 1;
      else acc.provisioning += 1;

      return acc;
    },
    { total: 0, completed: 0, provisioning: 0, expired: 0 }
  );

  const recentRequests = [...normalizedRequests]
    .sort((left, right) => {
      const leftDate = new Date(left?.created_at || left?.createdAt || 0).getTime();
      const rightDate = new Date(right?.created_at || right?.createdAt || 0).getTime();
      return rightDate - leftDate;
    })
    .slice(0, 6);

  return (
    <main className="app-shell page-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__eyebrow">Azure Access Portal</span>
          <h1>Customer Provisioning Dashboard</h1>
          <p>
            Monitor Azure lifecycle requests, provisioning status, credential delivery, and expiry
            in one workspace.
          </p>
        </div>

        <div className="topbar-actions">
          <Link className="btn btn--secondary" href="/dashboard">
            Refresh
          </Link>
          <Link className="btn btn--primary" href="/request">
            New Request
          </Link>
        </div>
      </header>

      <section className="hero-grid">
        <article className="panel hero-card">
          <div className="panel__inner">
            <div className="hero-copy">
              <span className="eyebrow">Lifecycle overview</span>
              <h2>Provision Azure access with a single guided request.</h2>
              <p>
                Submit customer details, estimate pricing, create the request, provision the
                resource group, create users, assign RBAC, send credentials, and expire access on
                schedule.
              </p>
              <div className="button-row">
                <Link className="btn btn--primary" href="/request">
                  Create Request
                </Link>
                <Link className="btn btn--ghost" href="/dashboard">
                  View Dashboard
                </Link>
              </div>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel__inner stack">
            <div className="panel__heading">
              <div>
                <h3>Latest Sync</h3>
                <p>Dashboard totals are loaded from the backend request list.</p>
              </div>
              <span className="helper-badge">
                {lastUpdated ? `Updated ${formatDateTime(lastUpdated)}` : 'Live'}
              </span>
            </div>

            <div className="current-request-card">
              <div className="current-request-card__label">Most Recent Request</div>
              <div className="current-request-card__value">
                {recentRequests[0] ? `#${recentRequests[0].id || recentRequests[0].request_id}` : 'None'}
              </div>
              <div className="current-request-card__meta">
                {recentRequests[0]
                  ? `${recentRequests[0].customer_email || 'Unknown customer'} | ${
                      recentRequests[0].location || 'Unknown region'
                    }`
                  : 'No requests have been created yet.'}
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="metrics-grid">
        {metricCards.map((card) => (
          <article className="stat-card" key={card.key}>
            <span>{card.label}</span>
            <strong>{formatCompactNumber(stats[card.key] || 0)}</strong>
          </article>
        ))}
      </section>

      <section className="dashboard-grid" style={{ marginTop: 20 }}>
        <article className="panel">
          <div className="panel__inner">
            <div className="panel__heading">
              <div>
                <h3>Recent Requests</h3>
                <p>Most recent provisioning requests received by the backend.</p>
              </div>
              <span className="helper-badge">{formatCompactNumber(recentRequests.length)} shown</span>
            </div>

            {error ? <div className="error-box">{error}</div> : null}

            <div className="request-list">
              {recentRequests.length > 0 ? (
                recentRequests.map((request) => {
                  const requestId = request?.id || request?.request_id;
                  const tone = statusTone(request?.status);

                  return (
                    <div className="request-row" key={requestId || `${request.customer_email}-${request.created_at}`}>
                      <div>
                        <div className="request-row__label">Request</div>
                        <div className="request-row__value request-row__value--title">
                          #{requestId || '-'}
                        </div>
                        <div className="request-row__value" style={{ color: 'var(--muted)' }}>
                          {request.customer_email || 'No customer email'}
                        </div>
                      </div>

                      <div>
                        <div className="request-row__label">Status</div>
                        <div className={`status-chip status-chip--${tone}`}>
                          {request.status || 'Pending'}
                        </div>
                      </div>

                      <div>
                        <div className="request-row__label">Region</div>
                        <div className="request-row__value">{request.location || '-'}</div>
                      </div>

                      <div>
                        <div className="request-row__label">Price</div>
                        <div className="request-row__value">
                          {request.estimated_price ?? request.estimatedPrice
                            ? formatCurrency(request.estimated_price ?? request.estimatedPrice)
                            : '-'}
                        </div>
                      </div>

                      <div>
                        <div className="request-row__label">Created</div>
                        <div className="request-row__value">
                          {formatDateTime(request.created_at || request.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <EmptyRequestState />
              )}
            </div>
          </div>
        </article>

        <aside className="panel">
          <div className="panel__inner">
            <div className="panel__heading">
              <div>
                <h3>Operational Notes</h3>
                <p>Useful signals for support and operators.</p>
              </div>
            </div>

            <div className="stack">
              <div className="status-card">
                <span>Dashboard source</span>
                <strong>GET /api/requests</strong>
                <p className="dashboard-subcopy">
                  The Next.js app keeps the backend unchanged and renders data through `fetch()`.
                </p>
              </div>

              <div className="status-card">
                <span>Created requests</span>
                <strong>{formatCompactNumber(stats.total)}</strong>
                <p className="dashboard-subcopy">
                  Completed: {formatCompactNumber(stats.completed)} | Provisioning:{' '}
                  {formatCompactNumber(stats.provisioning)} | Expired:{' '}
                  {formatCompactNumber(stats.expired)}
                </p>
              </div>

              <div className="status-card">
                <span>Average pricing signal</span>
                <strong>
                  {normalizedRequests.length > 0
                    ? formatCurrency(
                        normalizedRequests.reduce((sum, request) => {
                          const price = Number(
                            request.estimated_price ?? request.estimatedPrice ?? 0
                          );
                          return sum + price;
                        }, 0) / normalizedRequests.length
                      )
                    : '-'}
                </strong>
                <p className="dashboard-subcopy">
                  Derived from the estimated price attached to each request record.
                </p>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
