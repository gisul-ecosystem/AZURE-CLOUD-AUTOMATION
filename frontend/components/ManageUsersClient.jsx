'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  deleteManageUser,
  exchangeManageToken,
  getManageRequest,
  updateManageUserRoles,
  startUsageSession,
  getUsageStatus
} from '../services/api';

const STORAGE_KEY_SESSION = 'manage-portal-session-token';
const STORAGE_KEY_REQUEST = 'manage-portal-request-id';
const STORAGE_KEY_EMAIL = 'manage-portal-customer-email';
const STORAGE_KEY_RESOURCE_GROUP = 'manage-portal-resource-group';
const STORAGE_KEY_USER_ID = 'manage-portal-user-id';

const formatDisplayDate = (value) => {
  if (!value) {
    return '-';
  }

  const isDateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = isDateOnly ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  });
};

const parseRoleInput = (value) =>
  String(value || '')
    .split(/[\n,]/)
    .map((role) => role.trim())
    .filter(Boolean);

export default function ManageUsersClient() {
  const [sessionToken, setSessionToken] = useState('');
  const [requestId, setRequestId] = useState('');
  const [resourceGroup, setResourceGroup] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState(null);
  const [activeUserId, setActiveUserId] = useState('');
  const [draftRoles, setDraftRoles] = useState('');

  const persistSessionToken = (value) => {
    setSessionToken(value);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(STORAGE_KEY_SESSION, value);
    }
  };

  const persistRequestId = (value) => {
    setRequestId(value);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(STORAGE_KEY_REQUEST, value);
    }
  };

  const persistCustomerEmail = (value) => {
    setCustomerEmail(value);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(STORAGE_KEY_EMAIL, value);
    }
  };

  const persistResourceGroup = (value) => {
    setResourceGroup(value);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(STORAGE_KEY_RESOURCE_GROUP, value);
    }
  };

  const persistUserId = (value) => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(STORAGE_KEY_USER_ID, value);
    }
  };

  const handleAccessError = (error) => {
    // Check if this is a 403 blocked/limit exceeded error
    if (error.status === 403) {
      const message = error.message || '';
      if (message.includes('Daily usage limit') || message.includes('blocked')) {
        // Clear session and show blocking message
        if (typeof window !== 'undefined') {
          window.sessionStorage.clear();
        }
        setError('Daily usage limit reached. Access will be restored tomorrow. Please try again later.');
        setSessionToken('');
        return true;
      }
    }
    return false;
  };

  const autoStartUsageSession = async (reqId, usrId) => {
    if (!reqId || !usrId) {
      return;
    }

    try {
      console.log('[AUTO_SESSION] Starting usage session:', { requestId: reqId, userId: usrId });
      await startUsageSession(reqId, usrId);
      console.log('[AUTO_SESSION] Session started successfully');
    } catch (sessionError) {
      console.error('[AUTO_SESSION] Failed to start session:', sessionError.message);
      // Don't block portal access if session start fails
    }
  };

  const loadUsers = async (token, currentRequestId) => {
    try {
      const payload = await getManageRequest(token, currentRequestId);
      persistRequestId(String(payload?.requestId || currentRequestId || ''));
      setUsers(Array.isArray(payload?.users) ? payload.users : []);
    } catch (error) {
      if (handleAccessError(error)) {
        throw error;
      }
      throw error;
    }
  };

  useEffect(() => {
    const boot = async () => {
      setLoading(true);
      setError('');

      try {
        const existingToken =
          typeof window !== 'undefined' ? window.sessionStorage.getItem(STORAGE_KEY_SESSION) || '' : '';
        const existingRequestId =
          typeof window !== 'undefined' ? window.sessionStorage.getItem(STORAGE_KEY_REQUEST) || '' : '';
        const existingCustomerEmail =
          typeof window !== 'undefined' ? window.sessionStorage.getItem(STORAGE_KEY_EMAIL) || '' : '';
        const existingResourceGroup =
          typeof window !== 'undefined' ? window.sessionStorage.getItem(STORAGE_KEY_RESOURCE_GROUP) || '' : '';
        const existingUserId =
          typeof window !== 'undefined' ? window.sessionStorage.getItem(STORAGE_KEY_USER_ID) || '' : '';
        const params = new URLSearchParams(window.location.search);
        const rawToken = params.get('token') || '';
        const tokenToUse = rawToken || existingToken;

        if (!tokenToUse) {
          throw new Error('Missing access token. Open the link from your email.');
        }

        let token = existingToken;
        let activeRequestId = existingRequestId;
        let activeUserId = existingUserId;

        if (!existingToken && rawToken) {
          const bootstrapData = await exchangeManageToken(rawToken);
          token = bootstrapData.sessionToken || '';
          activeRequestId = String(bootstrapData.requestId || '');
          activeUserId = String(bootstrapData.userId || '');

          if (!token) {
            throw new Error('Access portal session could not be created.');
          }

          persistSessionToken(token);
          persistRequestId(activeRequestId);
          persistResourceGroup(bootstrapData.resourceGroup || '');
          persistCustomerEmail(bootstrapData.customerEmail || '');
          if (activeUserId) {
            persistUserId(activeUserId);
          }
        }

        if (!token) {
          throw new Error('Access session is unavailable.');
        }

        if (!activeRequestId) {
          throw new Error('Access request is unavailable.');
        }

        persistSessionToken(token);
        persistRequestId(activeRequestId);
        if (existingCustomerEmail) {
          persistCustomerEmail(existingCustomerEmail);
        }
        if (existingResourceGroup) {
          persistResourceGroup(existingResourceGroup);
        }
        if (existingUserId) {
          persistUserId(existingUserId);
        }
        
        // Auto-start usage session if userId is available
        if (activeRequestId && activeUserId) {
          await autoStartUsageSession(activeRequestId, activeUserId);
        }
        
        await loadUsers(token, activeRequestId);
      } catch (bootError) {
        if (!handleAccessError(bootError)) {
          setError(bootError.message || 'Unable to open access portal.');
        }
      } finally {
        setLoading(false);
      }
    };

    boot();
  }, []);

  const refreshUsers = async () => {
    if (!sessionToken || !requestId) {
      return;
    }

    setRefreshing(true);
    setError('');

    try {
      await loadUsers(sessionToken, requestId);
    } catch (refreshError) {
      if (!handleAccessError(refreshError)) {
        setError(refreshError.message || 'Unable to refresh users.');
      }
    } finally {
      setRefreshing(false);
    }
  };

  const clearAction = () => {
    setAction(null);
    setActiveUserId('');
    setDraftRoles('');
  };

  const openRoleEditor = (user) => {
    setAction('roles');
    setActiveUserId(user.id);
    setDraftRoles(
      Array.isArray(user.roles)
        ? user.roles.map((entry) => entry?.role).filter(Boolean).join(', ')
        : ''
    );
  };

  const handleDelete = async (userId) => {
    if (!sessionToken) return;

    setSaving(true);
    setError('');

    try {
      await deleteManageUser(sessionToken, requestId, userId);
      await refreshUsers();
      clearAction();
    } catch (deleteError) {
      if (!handleAccessError(deleteError)) {
        setError(deleteError.message || 'Unable to delete user.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRoles = async () => {
    if (!sessionToken || !activeUserId) return;

    const roles = parseRoleInput(draftRoles);
    if (roles.length === 0) {
      setError('Enter at least one role name.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await updateManageUserRoles(sessionToken, requestId, activeUserId, roles);
      await refreshUsers();
      clearAction();
    } catch (updateError) {
      if (!handleAccessError(updateError)) {
        setError(updateError.message || 'Unable to update roles.');
      }
    } finally {
      setSaving(false);
    }
  };

  const activeUser = users.find((user) => String(user.id) === String(activeUserId)) || null;

  return (
    <main className="app-shell page-shell manage-users-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__eyebrow">Access Portal</span>
          <h1>Manage Provisioned Users</h1>
          <p>
            Review provisioned Azure users, change assigned roles, revoke access, and refresh the
            portal from one secure link.
          </p>
        </div>

        <div className="topbar-actions">
          <button type="button" className="btn btn--secondary" onClick={refreshUsers} disabled={refreshing || loading}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <Link className="btn btn--ghost" href="/dashboard">
            Dashboard
          </Link>
        </div>
      </header>

      <section className="dashboard-grid">
        <section className="panel">
          <div className="panel__inner">
            <div className="panel__heading">
              <div>
                <h3>Portal Summary</h3>
                <p>Loaded from the single-use access link exchanged on first open.</p>
              </div>
              <span className="helper-badge">{loading ? 'Loading' : `${users.length} users`}</span>
            </div>

            {error ? <div className="error-box">{error}</div> : null}

              <div className="summary-grid">
                <div className="summary-card">
                  <span>Request ID</span>
                  <strong>{requestId ? `#${requestId}` : '-'}</strong>
                </div>
              <div className="summary-card">
                <span>Resource Group</span>
                <strong>{resourceGroup || '-'}</strong>
              </div>
              <div className="summary-card">
                <span>Customer Email</span>
                <strong style={{ fontSize: '1rem' }}>{customerEmail || '-'}</strong>
              </div>
              <div className="summary-card">
                <span>Portal Session</span>
                <strong>{sessionToken ? 'Active' : 'Missing'}</strong>
              </div>
            </div>

            <div style={{ height: 18 }} />

            {loading ? (
              <div className="loading-card">
                <p className="loading-card__text">Opening access portal...</p>
              </div>
            ) : (
              <div className="manage-users-table-wrap">
                <table className="manage-users-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Azure User ID</th>
                      <th>Status</th>
                      <th>Role</th>
                      <th>Expiry</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length > 0 ? (
                      users.map((user) => (
                        <tr key={user.id}>
                          <td>
                            <strong>{user.username || '-'}</strong>
                          </td>
                          <td>
                            <div className="manage-users-meta">{user.azureUserId || '-'}</div>
                          </td>
                          <td>
                            <span className="status-chip status-chip--unknown">{user.status || '-'}</span>
                          </td>
                          <td>
                            <div className="manage-users-chip-row">
                              {Array.isArray(user.roles) && user.roles.length > 0 ? (
                                user.roles.map((entry) => (
                                  <span className="manage-users-chip" key={`${user.id}-${entry.role}-${entry.scope}`}>
                                    {entry.role}
                                  </span>
                                ))
                              ) : (
                                <span className="manage-users-meta">No roles assigned</span>
                              )}
                            </div>
                          </td>
                          <td>{formatDisplayDate(user.expiryDate)}</td>
                          <td>
                            <div className="manage-users-actions">
                              <button
                                type="button"
                                className="btn btn--ghost"
                                onClick={() => openRoleEditor(user)}
                                disabled={saving}
                              >
                                Change Role
                              </button>
                              <button
                                type="button"
                                className="btn btn--primary"
                                onClick={() => handleDelete(user.id)}
                                disabled={saving}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6}>
                          <div className="manage-users-empty">No active users are available.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <aside className="stack">
          <section className="panel">
            <div className="panel__inner">
              <div className="panel__heading">
                <div>
                  <h3>Action Editor</h3>
                  <p>Use the selected action to change RBAC for the chosen user.</p>
                </div>
                <span className="helper-badge">{action ? action : 'Idle'}</span>
              </div>

              {activeUser ? (
                <div className="status-card">
                  <span>Selected User</span>
                  <strong>{activeUser.username || activeUser.azureUserId}</strong>
                  <p className="dashboard-subcopy">{activeUser.azureUserId}</p>
                </div>
              ) : null}

              {action === 'roles' ? (
                <div className="manage-users-form">
                  <label className="field">
                    <span className="field__label">Roles</span>
                    <textarea
                      value={draftRoles}
                      onChange={(event) => setDraftRoles(event.target.value)}
                      placeholder="Reader, Contributor"
                    />
                  </label>
                  <p className="inline-note">Separate multiple roles with commas or new lines.</p>
                </div>
              ) : null}

              {action ? (
                <div className="button-row" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handleSaveRoles}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button type="button" className="btn btn--secondary" onClick={clearAction} disabled={saving}>
                    Cancel
                  </button>
                </div>
              ) : (
                <p className="inline-note">Pick a user action from the table to start editing.</p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel__inner">
              <div className="panel__heading">
                <div>
                  <h3>Security Notes</h3>
                  <p>Token exchange happens once and a session token powers the portal after that.</p>
                </div>
              </div>
              <ul className="manage-notes">
                <li>Portal links expire after 7 days.</li>
                <li>Deleted users are removed from Azure AD and cleared from the portal tables.</li>
                <li>Role changes reapply Azure RBAC at the resource-group scope.</li>
              </ul>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
