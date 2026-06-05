'use client';

import Link from 'next/link';
import ProgressStepper from './ProgressStepper';
import RequestTimeline from './RequestTimeline';
import SuccessCard from './SuccessCard';
import { useProvisionFlow } from '../hooks/useProvisionFlow';
import { formatDateTime, statusTone } from '../utils/formatters';

export default function ProvisionStatusClient({ requestId, initialSnapshot = null }) {
  const {
    progress,
    stepStates,
    resourceGroup,
    usersCreated,
    rolesAssigned,
    deliveryStatus,
    completed,
    error,
    loading,
    running,
    refreshing,
    lastUpdated,
    events,
    retry,
    requestRecord
  } = useProvisionFlow(requestId, initialSnapshot);

  const requestStatus = requestRecord?.status || 'Pending';
  const tone = statusTone(requestStatus);
  const customerEmail = requestRecord?.customer_email || requestRecord?.customerEmail || '';
  const estimatedPrice = requestRecord?.estimated_price || requestRecord?.estimatedPrice || null;

  return (
    <main className="app-shell page-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__eyebrow">Provisioning Progress</span>
          <h1>Request #{requestId}</h1>
          <p>
            The backend is provisioning Azure access. This page updates live, step by step, until
            the request is complete.
          </p>
        </div>

        <div className="topbar-actions">
          <Link className="btn btn--secondary" href="/dashboard">
            Dashboard
          </Link>
          <Link className="btn btn--ghost" href="/request">
            New Request
          </Link>
        </div>
      </header>

      <section className={completed ? 'success-layout' : 'content-grid'}>
        <div className="stack">
          <ProgressStepper steps={stepStates} progress={progress} />

          <section className="panel">
            <div className="panel__inner">
              <div className="panel__heading">
                <div>
                  <h3>Request Summary</h3>
                  <p>Live data from the backend polling cycle.</p>
                </div>
                <span className={`status-chip status-chip--${tone}`}>{requestStatus}</span>
              </div>

              <div className="summary-grid">
                <div className="summary-card">
                  <span>Request ID</span>
                  <strong>#{requestId}</strong>
                </div>
                <div className="summary-card resource-group-card">
                  <span>Resource Group</span>
                  <strong>{resourceGroup || '-'}</strong>
                </div>
                <div className="summary-card">
                  <span>Users Created</span>
                  <strong>{usersCreated}</strong>
                </div>
                <div className="summary-card">
                  <span>Roles Assigned</span>
                  <strong>{rolesAssigned}</strong>
                </div>
                <div className="summary-card">
                  <span>Credential Status</span>
                  <strong>{deliveryStatus}</strong>
                </div>
                <div className="summary-card">
                  <span>Last Refresh</span>
                  <strong>{refreshing || loading ? 'Updating...' : lastUpdated ? formatDateTime(lastUpdated) : '-'}</strong>
                </div>
              </div>

              {error ? <div className="error-box">{error}</div> : null}

              <div className="button-row" style={{ marginTop: 4 }}>
                <button type="button" className="btn btn--primary" onClick={retry} disabled={running}>
                  {error ? 'Retry provisioning' : 'Refresh and retry'}
                </button>
                <span className="inline-note">
                  The backend is idempotent, so retrying will continue from any completed step.
                </span>
              </div>
            </div>
          </section>

          {completed ? (
            <SuccessCard
              requestId={requestId}
              resourceGroup={resourceGroup}
              usersCreated={usersCreated}
              rolesAssigned={rolesAssigned}
              deliveryStatus={deliveryStatus}
              customerEmail={customerEmail}
              estimatedPrice={estimatedPrice}
            />
          ) : null}
        </div>

        <aside className="stack">
          <RequestTimeline
            title="Request Timeline"
            description="Live events from the provisioning orchestrator."
            events={
              events.length > 0
                ? events
                : [
                    {
                      title: 'Request created',
                      message:
                        'The workflow is waiting for the provisioning orchestration to complete.'
                    }
                  ]
            }
          />

          <section className="panel">
            <div className="panel__inner">
              <div className="panel__heading">
                <div>
                  <h3>Resource Group Card</h3>
                  <p>Quick access to the provisioned resource group.</p>
                </div>
              </div>

              <div className="current-request-card">
                <div className="current-request-card__label">Resource Group</div>
                <div className="current-request-card__value">{resourceGroup || '-'}</div>
                <div className="current-request-card__meta">
                  {resourceGroup
                    ? 'This value is read from the provisioning endpoint and request record.'
                    : 'Waiting for the resource group to be created.'}
                </div>
              </div>

              <div style={{ height: 12 }} />

              <div className="status-card">
                <span>Credential status</span>
                <strong>{deliveryStatus}</strong>
                <p className="dashboard-subcopy">
                  Credentials are delivered by the backend email step and reported here through
                  polling.
                </p>
              </div>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
