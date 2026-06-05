import Link from 'next/link';
import { formatCurrency } from '../utils/formatters';

export default function SuccessCard({
  requestId,
  resourceGroup,
  usersCreated = 0,
  rolesAssigned = 0,
  deliveryStatus = 'Sent',
  customerEmail = '',
  estimatedPrice = null
}) {
  return (
    <section className="panel success-card">
      <div className="panel__heading">
        <div>
          <span className="brand__eyebrow">Provisioning complete</span>
          <h2>Request #{requestId} is ready</h2>
        </div>
        <span className="status-badge status-chip--sent">Completed</span>
      </div>

      <p>
        The resource group was created, users were provisioned, RBAC roles were assigned, and
        credentials were delivered successfully.
      </p>

      <div className="success-card__grid">
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
          <span>Estimated Price</span>
          <strong>{estimatedPrice !== null ? formatCurrency(estimatedPrice) : '-'}</strong>
        </div>
      </div>

      {customerEmail ? (
        <div className="notice">
          Credentials were delivered to <strong>{customerEmail}</strong>.
        </div>
      ) : null}

      <div className="button-row">
        <Link className="btn btn--secondary" href="/dashboard">
          Back to Dashboard
        </Link>
        <Link className="btn btn--primary" href="/request">
          New Request
        </Link>
      </div>
    </section>
  );
}
