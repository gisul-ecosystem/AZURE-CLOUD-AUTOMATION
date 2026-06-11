'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  deleteOrgAdminUser,
  forceOrgAdminLogout,
  getOrgMonitoringLogs,
  getOrgResourceGroupDetail,
  listOrgAccessRequests,
  listOrgResourceGroups,
  loginOrgAdmin,
  reviewOrgAccessRequest,
  updateOrgAdminUserRoles
} from '../services/api';
import { formatDateTime, statusTone } from '../utils/formatters';

const STORAGE_KEY = 'org-admin-session-token';
const STORAGE_KEY_ADMIN = 'org-admin-profile';

const formatMinutes = (minutes) => {
  const value = Number(minutes || 0);
  const hours = Math.floor(value / 60);
  const mins = Math.round(value % 60);

  if (hours > 0 && mins > 0) {
    return `${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${mins}m`;
};

const parseRoleInput = (value) =>
  String(value || '')
    .split(/[\n,]/)
    .map((role) => role.trim())
    .filter(Boolean);

const summarizeSchedule = (schedule) => {
  if (!schedule || typeof schedule !== 'object') {
    return 'No schedule';
  }

  const timezone = schedule.timezone || 'UTC';
  const days = Object.entries(schedule.days || {})
    .filter(([, day]) => day?.enabled && Array.isArray(day.slots) && day.slots.length > 0)
    .map(([day, value]) => {
      const slots = value.slots.map((slot) => `${slot.start}-${slot.end}`).join(', ');
      return `${day}: ${slots}`;
    });

  if (days.length === 0) {
    return `All day (${timezone})`;
  }

  return `${days.slice(0, 2).join(' | ')}${days.length > 2 ? ' ...' : ''} (${timezone})`;
};

export default function OrgAdminClient() {
  const [sessionToken, setSessionToken] = useState('');
  const [adminProfile, setAdminProfile] = useState(null);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [resourceGroups, setResourceGroups] = useState([]);
  const [accessRequests, setAccessRequests] = useState([]);
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [selectedAccessRequestId, setSelectedAccessRequestId] = useState(null);
  const [workspacePanel, setWorkspacePanel] = useState('resource-group');
  const [detail, setDetail] = useState(null);
  const [monitoring, setMonitoring] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeUserId, setActiveUserId] = useState('');
  const [draftRoles, setDraftRoles] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [logTab, setLogTab] = useState('sessions');

  const persistSession = (token, admin) => {
    setSessionToken(token);
    setAdminProfile(admin);
    window.localStorage.setItem(STORAGE_KEY, token);
    window.localStorage.setItem(STORAGE_KEY_ADMIN, JSON.stringify(admin || null));
  };

  const clearSession = () => {
    setSessionToken('');
    setAdminProfile(null);
    setResourceGroups([]);
    setAccessRequests([]);
    setSelectedRequestId(null);
    setSelectedAccessRequestId(null);
    setWorkspacePanel('resource-group');
    setDetail(null);
    setMonitoring(null);
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(STORAGE_KEY_ADMIN);
  };

  const handleAuthError = (authError) => {
    if (authError?.status === 401) {
      clearSession();
      setError('Your organization admin session expired. Sign in again.');
      return true;
    }
    return false;
  };

  const loadAccessRequests = useCallback(async (token) => {
    const response = await listOrgAccessRequests(token, { status: 'pending' });
    const requests = response?.requests || [];
    setAccessRequests(requests);
    return requests;
  }, []);

  const loadOverview = useCallback(async (token) => {
    const [groups, requests] = await Promise.all([
      listOrgResourceGroups(token).then((response) => response?.resourceGroups || []),
      loadAccessRequests(token)
    ]);
    setResourceGroups(groups);
    return { groups, requests };
  }, [loadAccessRequests]);

  const loadDetail = useCallback(async (token, requestId) => {
    const [detailResponse, monitoringResponse] = await Promise.all([
      getOrgResourceGroupDetail(token, requestId),
      getOrgMonitoringLogs(token, requestId, { limit: 100 })
    ]);

    setDetail({
      request: detailResponse?.request || null,
      users: detailResponse?.users || []
    });
    setMonitoring({
      usageSessions: monitoringResponse?.usageSessions || [],
      enforcementLogs: monitoringResponse?.enforcementLogs || [],
      auditLogs: monitoringResponse?.auditLogs || []
    });
  }, []);

  useEffect(() => {
    const boot = async () => {
      const storedToken = window.localStorage.getItem(STORAGE_KEY) || '';
      const storedAdmin = window.localStorage.getItem(STORAGE_KEY_ADMIN);

      if (!storedToken) {
        setLoading(false);
        return;
      }

      setSessionToken(storedToken);
      if (storedAdmin) {
        try {
          setAdminProfile(JSON.parse(storedAdmin));
        } catch {
          setAdminProfile(null);
        }
      }

      try {
        const { groups } = await loadOverview(storedToken);
        if (groups.length > 0) {
          const firstId = groups[0].requestId;
          setSelectedRequestId(firstId);
          setWorkspacePanel('resource-group');
          await loadDetail(storedToken, firstId);
        }
      } catch (bootError) {
        if (!handleAuthError(bootError)) {
          setError(bootError.message || 'Unable to load organization admin portal.');
        }
      } finally {
        setLoading(false);
      }
    };

    boot();
  }, [loadDetail, loadOverview]);

  const handleLogin = async (event) => {
    event.preventDefault();

    if (!email.trim() || !username.trim() || !password) {
      setError('Enter your organization admin email, username, and password.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await loginOrgAdmin({
        email: email.trim(),
        username: username.trim(),
        password
      });

      setPassword('');
      persistSession(response.sessionToken, response.admin);

      const { groups } = await loadOverview(response.sessionToken);
      if (groups.length > 0) {
        const firstId = groups[0].requestId;
        setSelectedRequestId(firstId);
        setWorkspacePanel('resource-group');
        await loadDetail(response.sessionToken, firstId);
      }
    } catch (loginError) {
      setError(loginError.message || 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  const refreshAll = async () => {
    if (!sessionToken) {
      return;
    }

    setRefreshing(true);
    setError('');

    try {
      await loadOverview(sessionToken);
      if (selectedRequestId && workspacePanel === 'resource-group') {
        await loadDetail(sessionToken, selectedRequestId);
      }
    } catch (refreshError) {
      if (!handleAuthError(refreshError)) {
        setError(refreshError.message || 'Unable to refresh data.');
      }
    } finally {
      setRefreshing(false);
    }
  };

  const selectResourceGroup = async (requestId) => {
    if (!sessionToken) {
      return;
    }

    setWorkspacePanel('resource-group');
    setSelectedAccessRequestId(null);
    setReviewNotes('');

    if (String(requestId) === String(selectedRequestId)) {
      return;
    }

    setSelectedRequestId(requestId);
    setActiveUserId('');
    setDraftRoles('');
    setError('');

    try {
      await loadDetail(sessionToken, requestId);
    } catch (selectError) {
      if (!handleAuthError(selectError)) {
        setError(selectError.message || 'Unable to load resource group details.');
      }
    }
  };

  const openRoleEditor = (user) => {
    setActiveUserId(user.id);
    setDraftRoles(
      Array.isArray(user.roles)
        ? user.roles.map((entry) => entry?.role).filter(Boolean).join(', ')
        : ''
    );
  };

  const handleDeleteUser = async (userId) => {
    if (!sessionToken || !selectedRequestId) {
      return;
    }

    setSaving(true);
    setError('');

    try {
      await deleteOrgAdminUser(sessionToken, selectedRequestId, userId);
      await loadDetail(sessionToken, selectedRequestId);
      await loadOverview(sessionToken);
      setActiveUserId('');
      setDraftRoles('');
    } catch (deleteError) {
      if (!handleAuthError(deleteError)) {
        setError(deleteError.message || 'Unable to delete user.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRoles = async () => {
    if (!sessionToken || !selectedRequestId || !activeUserId) {
      return;
    }

    const roles = parseRoleInput(draftRoles);
    if (roles.length === 0) {
      setError('Enter at least one role name.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await updateOrgAdminUserRoles(sessionToken, selectedRequestId, activeUserId, roles);
      await loadDetail(sessionToken, selectedRequestId);
      setActiveUserId('');
      setDraftRoles('');
    } catch (updateError) {
      if (!handleAuthError(updateError)) {
        setError(updateError.message || 'Unable to update roles.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleForceLogout = async (userId) => {
    if (!sessionToken || !selectedRequestId) {
      return;
    }

    setSaving(true);
    setError('');

    try {
      await forceOrgAdminLogout(sessionToken, selectedRequestId, userId);
      await loadDetail(sessionToken, selectedRequestId);
    } catch (logoutError) {
      if (!handleAuthError(logoutError)) {
        setError(logoutError.message || 'Unable to force logout user.');
      }
    } finally {
      setSaving(false);
    }
  };

  const selectAccessRequest = (accessRequestId) => {
    setWorkspacePanel('access-request');
    setSelectedAccessRequestId(accessRequestId);
    setReviewNotes('');
    setActiveUserId('');
    setDraftRoles('');
  };

  const handleReviewAccessRequest = async (status) => {
    if (!sessionToken || !selectedAccessRequestId) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccessMessage('');

    try {
      const result = await reviewOrgAccessRequest(sessionToken, selectedAccessRequestId, {
        status,
        reviewNotes: reviewNotes.trim() || undefined
      });
      await loadAccessRequests(sessionToken);
      setSelectedAccessRequestId(null);
      setReviewNotes('');
      setWorkspacePanel(resourceGroups.length > 0 ? 'resource-group' : 'access-request');

      const request = result?.request;
      if (status === 'approved') {
        const roles = Array.isArray(request?.grantedRoles) ? request.grantedRoles : [];
        const roleSummary = roles.length > 0 ? roles.join(', ') : 'requested permissions';
        if (request?.accessApplied) {
          setSuccessMessage(
            `Access approved. ${roleSummary} ${roles.length === 1 ? 'has' : 'have'} been granted and the customer was emailed.`
          );
        } else {
          setSuccessMessage(
            `Access approved. ${roleSummary} will be applied automatically once the Azure environment is ready, and the customer was emailed.`
          );
        }
      } else {
        setSuccessMessage(
          request?.emailSent
            ? 'Access request rejected and the customer was emailed.'
            : 'Access request rejected.'
        );
      }
    } catch (reviewError) {
      if (!handleAuthError(reviewError)) {
        setError(reviewError.message || 'Unable to review access request.');
      }
    } finally {
      setSaving(false);
    }
  };

  const activeAccessRequest =
    accessRequests.find((entry) => String(entry.id) === String(selectedAccessRequestId)) || null;

  const activeUser =
    detail?.users?.find((user) => String(user.id) === String(activeUserId)) || null;

  if (!sessionToken) {
    return (
      <main className="app-shell page-shell manage-auth-shell">
        <section className="panel manage-auth-panel">
          <div className="panel__inner">
            <div className="panel__heading">
              <div>
                <h1>Organization Admin</h1>
                <p>
                  Sign in to manage all provisioned resource groups, users, login sessions, and
                  usage monitoring from one workspace.
                </p>
              </div>
              <span className="helper-badge">Platform Admin</span>
            </div>

            {error ? <div className="error-box">{error}</div> : null}

            <form className="manage-auth-form" onSubmit={handleLogin}>
              <label className="field">
                <span className="field__label">Admin Email</span>
                <input
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="admin@company.com"
                />
              </label>
              <label className="field">
                <span className="field__label">Username</span>
                <input
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="org-admin"
                />
              </label>
              <label className="field">
                <span className="field__label">Password</span>
                <input
                  autoComplete="current-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="password"
                />
              </label>
              <button type="submit" className="btn btn--primary" disabled={loading}>
                {loading ? 'Signing in...' : 'Open Organization Admin'}
              </button>
            </form>

            <p className="inline-note" style={{ marginTop: 16 }}>
              Configure credentials with ORG_ADMIN_EMAIL, ORG_ADMIN_USERNAME, and ORG_ADMIN_PASSWORD
              in the backend environment.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell page-shell org-admin-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__eyebrow">Organization Admin</span>
          <h1>Resource Groups &amp; User Monitoring</h1>
          <p>
            Review every provisioned resource group, manage Azure users, and inspect login sessions,
            daily usage limits, and enforcement activity.
          </p>
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={refreshAll}
            disabled={refreshing || loading}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={clearSession}>
            Sign Out
          </button>
          <Link className="btn btn--ghost" href="/dashboard">
            Dashboard
          </Link>
        </div>
      </header>

      {error ? <div className="error-box">{error}</div> : null}
      {successMessage ? <div className="success-box">{successMessage}</div> : null}

      <section className="org-admin-layout">
        <aside className="panel org-admin-sidebar">
          <div className="panel__inner">
            <div className="panel__heading">
              <div>
                <h3>Requests</h3>
                <p>{accessRequests.length} pending admin access requests</p>
              </div>
              <span className="helper-badge">Review</span>
            </div>

            <div className="org-admin-rg-list" style={{ marginBottom: 18 }}>
              {accessRequests.length > 0 ? (
                accessRequests.map((request) => {
                  const isSelected =
                    workspacePanel === 'access-request' &&
                    String(request.id) === String(selectedAccessRequestId);

                  return (
                    <button
                      type="button"
                      key={request.id}
                      className={`org-admin-rg-card${isSelected ? ' org-admin-rg-card--active' : ''}`}
                      onClick={() => selectAccessRequest(request.id)}
                    >
                      <div className="org-admin-rg-card__title">{request.serviceName}</div>
                      <div className="org-admin-rg-card__meta">{request.customerEmail}</div>
                      <div className="org-admin-rg-card__stats">
                        <span className="status-chip status-chip--pending">Pending</span>
                        {request.requestId ? <span>Request #{request.requestId}</span> : <span>New request</span>}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="manage-users-empty">No pending admin access requests.</div>
              )}
            </div>

            <div className="panel__heading">
              <div>
                <h3>Resource Groups</h3>
                <p>{resourceGroups.length} provisioned groups</p>
              </div>
              <span className="helper-badge">{adminProfile?.username || 'Admin'}</span>
            </div>

            <div className="org-admin-rg-list">
              {resourceGroups.length > 0 ? (
                resourceGroups.map((group) => {
                  const tone = statusTone(group.status);
                  const isSelected = String(group.requestId) === String(selectedRequestId);

                  return (
                    <button
                      type="button"
                      key={group.requestId}
                      className={`org-admin-rg-card${isSelected ? ' org-admin-rg-card--active' : ''}`}
                      onClick={() => selectResourceGroup(group.requestId)}
                    >
                      <div className="org-admin-rg-card__title">{group.resourceGroup}</div>
                      <div className="org-admin-rg-card__meta">
                        Request #{group.requestId} | {group.customerEmail}
                      </div>
                      <div className="org-admin-rg-card__stats">
                        <span className={`status-chip status-chip--${tone}`}>{group.status}</span>
                        <span>{group.userCount} users</span>
                        {group.activeSessions > 0 ? (
                          <span className="org-admin-live">{group.activeSessions} live</span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="manage-users-empty">No provisioned resource groups yet.</div>
              )}
            </div>
          </div>
        </aside>

        <section className="org-admin-main stack">
          {workspacePanel === 'access-request' && activeAccessRequest ? (
            <section className="panel">
              <div className="panel__inner">
                <div className="panel__heading">
                  <div>
                    <h3>Admin Access Request</h3>
                    <p>
                      {activeAccessRequest.customerEmail} | {activeAccessRequest.serviceName}
                    </p>
                  </div>
                  <span className="status-chip status-chip--pending">{activeAccessRequest.status}</span>
                </div>

                <div className="summary-grid org-admin-summary-grid">
                  <div className="summary-card">
                    <span>Customer Email</span>
                    <strong>{activeAccessRequest.customerEmail}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Service</span>
                    <strong>{activeAccessRequest.serviceName}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Basic Permission</span>
                    <strong>{activeAccessRequest.defaultRole || 'Not specified'}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Account Count</span>
                    <strong>{activeAccessRequest.accountCount || 'Not specified'}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Linked Request</span>
                    <strong>
                      {activeAccessRequest.requestId ? `#${activeAccessRequest.requestId}` : 'Not linked yet'}
                    </strong>
                  </div>
                  <div className="summary-card">
                    <span>Submitted</span>
                    <strong>{formatDateTime(activeAccessRequest.createdAt)}</strong>
                  </div>
                </div>

                <div className="surface" style={{ padding: 16, marginTop: 16 }}>
                  <p className="field__label">Requested Access</p>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{activeAccessRequest.requestedAccess}</p>
                </div>

                <div className="manage-users-form" style={{ marginTop: 16 }}>
                  <label className="field">
                    <span className="field__label">Review Notes</span>
                    <textarea
                      value={reviewNotes}
                      onChange={(event) => setReviewNotes(event.target.value)}
                      placeholder="Optional notes for approval or rejection"
                    />
                  </label>
                  <div className="button-row" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => handleReviewAccessRequest('approved')}
                      disabled={saving}
                    >
                      {saving ? 'Saving...' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => handleReviewAccessRequest('rejected')}
                      disabled={saving}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ) : loading && !detail ? (
            <div className="loading-card">
              <p className="loading-card__text">Loading organization admin workspace...</p>
            </div>
          ) : detail?.request ? (
            <>
              <section className="panel">
                <div className="panel__inner">
                  <div className="panel__heading">
                    <div>
                      <h3>{detail.request.resourceGroup}</h3>
                      <p>
                        {detail.request.customerEmail} | {detail.request.location || 'Unknown region'}
                      </p>
                    </div>
                    <span className={`status-chip status-chip--${statusTone(detail.request.status)}`}>
                      {detail.request.status}
                    </span>
                  </div>

                  <div className="summary-grid org-admin-summary-grid">
                    <div className="summary-card">
                      <span>Request ID</span>
                      <strong>#{detail.request.requestId}</strong>
                    </div>
                    <div className="summary-card">
                      <span>Users</span>
                      <strong>{detail.users.length}</strong>
                    </div>
                    <div className="summary-card">
                      <span>Daily Limit</span>
                      <strong>
                        {detail.request.enableDailyUsage
                          ? formatMinutes(detail.request.dailyLimitMinutes)
                          : 'Disabled'}
                      </strong>
                    </div>
                    <div className="summary-card">
                      <span>Schedule</span>
                      <strong style={{ fontSize: '0.92rem' }}>
                        {summarizeSchedule(detail.request.usageSchedule)}
                      </strong>
                    </div>
                    <div className="summary-card">
                      <span>Expiry</span>
                      <strong>{formatDateTime(detail.request.expiryDate)}</strong>
                    </div>
                    <div className="summary-card">
                      <span>Azure Enforcement</span>
                      <strong>{detail.request.enforceInAzure ? 'Enabled' : 'Disabled'}</strong>
                    </div>
                  </div>
                </div>
              </section>

              <section className="panel">
                <div className="panel__inner">
                  <div className="panel__heading">
                    <div>
                      <h3>Provisioned Users</h3>
                      <p>Manage RBAC, revoke access, and review live usage for each Azure user.</p>
                    </div>
                    <span className="helper-badge">{detail.users.length} users</span>
                  </div>

                  <div className="manage-users-table-wrap">
                    <table className="manage-users-table">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Status</th>
                          <th>Roles</th>
                          <th>Usage Today</th>
                          <th>Last Login</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.users.length > 0 ? (
                          detail.users.map((user) => (
                            <tr key={user.id}>
                              <td>
                                <strong>{user.username}</strong>
                                <div className="manage-users-meta">{user.azureUserId}</div>
                              </td>
                              <td>
                                <span className={`status-chip status-chip--${statusTone(user.status)}`}>
                                  {user.status}
                                </span>
                                {user.hasActiveSession ? (
                                  <div className="org-admin-live" style={{ marginTop: 6 }}>
                                    Active session
                                  </div>
                                ) : null}
                                {user.blockedUntil ? (
                                  <div className="manage-users-meta">
                                    Blocked until {formatDateTime(user.blockedUntil)}
                                  </div>
                                ) : null}
                              </td>
                              <td>
                                <div className="manage-users-chip-row">
                                  {user.roles?.length > 0 ? (
                                    user.roles.map((entry) => (
                                      <span
                                        className="manage-users-chip"
                                        key={`${user.id}-${entry.role}-${entry.scope}`}
                                      >
                                        {entry.role}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="manage-users-meta">No roles</span>
                                  )}
                                </div>
                              </td>
                              <td>
                                {user.enableDailyUsage ? (
                                  <>
                                    <strong>{formatMinutes(user.usedTodayMinutes)}</strong>
                                    <div className="manage-users-meta">
                                      of {formatMinutes(user.dailyLimitMinutes)}
                                      {user.remainingMinutes !== null
                                        ? ` | ${formatMinutes(user.remainingMinutes)} left`
                                        : ''}
                                    </div>
                                  </>
                                ) : (
                                  <span className="manage-users-meta">Not tracked</span>
                                )}
                              </td>
                              <td>{formatDateTime(user.lastLoginAt)}</td>
                              <td>
                                <div className="manage-users-actions">
                                  <button
                                    type="button"
                                    className="btn btn--ghost"
                                    onClick={() => openRoleEditor(user)}
                                    disabled={saving}
                                  >
                                    Roles
                                  </button>
                                  {user.hasActiveSession ? (
                                    <button
                                      type="button"
                                      className="btn btn--secondary"
                                      onClick={() => handleForceLogout(user.id)}
                                      disabled={saving}
                                    >
                                      Force Logout
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="btn btn--primary"
                                    onClick={() => handleDeleteUser(user.id)}
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
                              <div className="manage-users-empty">No users in this resource group.</div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              <section className="dashboard-grid">
                <section className="panel">
                  <div className="panel__inner">
                    <div className="panel__heading">
                      <div>
                        <h3>Monitoring Logs</h3>
                        <p>Login sessions, enforcement actions, and portal audit history.</p>
                      </div>
                    </div>

                    <div className="org-admin-log-tabs">
                      {[
                        ['sessions', 'Login Sessions'],
                        ['enforcement', 'Enforcement'],
                        ['audit', 'Audit Trail']
                      ].map(([key, label]) => (
                        <button
                          type="button"
                          key={key}
                          className={`btn btn--ghost${logTab === key ? ' org-admin-log-tab--active' : ''}`}
                          onClick={() => setLogTab(key)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="manage-users-table-wrap" style={{ marginTop: 14 }}>
                      {logTab === 'sessions' ? (
                        <table className="manage-users-table">
                          <thead>
                            <tr>
                              <th>User</th>
                              <th>Login</th>
                              <th>Logout</th>
                              <th>Minutes</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {monitoring?.usageSessions?.length > 0 ? (
                              monitoring.usageSessions.map((session) => (
                                <tr key={session.id}>
                                  <td>{session.username}</td>
                                  <td>{formatDateTime(session.loginAt)}</td>
                                  <td>
                                    {session.logoutAt ? formatDateTime(session.logoutAt) : 'Still active'}
                                  </td>
                                  <td>
                                    {session.isActive
                                      ? formatMinutes(session.currentSessionMinutes)
                                      : formatMinutes(session.minutesUsed)}
                                  </td>
                                  <td>
                                    <span
                                      className={`status-chip status-chip--${
                                        session.isActive ? 'provisioning' : 'completed'
                                      }`}
                                    >
                                      {session.isActive ? 'Active' : 'Closed'}
                                    </span>
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={5}>
                                  <div className="manage-users-empty">No login sessions recorded yet.</div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      ) : null}

                      {logTab === 'enforcement' ? (
                        <table className="manage-users-table">
                          <thead>
                            <tr>
                              <th>User</th>
                              <th>Action</th>
                              <th>Details</th>
                              <th>Time</th>
                            </tr>
                          </thead>
                          <tbody>
                            {monitoring?.enforcementLogs?.length > 0 ? (
                              monitoring.enforcementLogs.map((log) => (
                                <tr key={log.id}>
                                  <td>{log.username}</td>
                                  <td>{log.action}</td>
                                  <td>
                                    <div className="manage-users-meta">
                                      {log.details ? JSON.stringify(log.details) : '-'}
                                    </div>
                                  </td>
                                  <td>{formatDateTime(log.createdAt)}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={4}>
                                  <div className="manage-users-empty">No enforcement events yet.</div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      ) : null}

                      {logTab === 'audit' ? (
                        <table className="manage-users-table">
                          <thead>
                            <tr>
                              <th>Actor</th>
                              <th>Action</th>
                              <th>Target</th>
                              <th>Time</th>
                            </tr>
                          </thead>
                          <tbody>
                            {monitoring?.auditLogs?.length > 0 ? (
                              monitoring.auditLogs.map((log) => (
                                <tr key={log.id}>
                                  <td>{log.actor}</td>
                                  <td>{log.action}</td>
                                  <td>{log.targetUserId || '-'}</td>
                                  <td>{formatDateTime(log.createdAt)}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={4}>
                                  <div className="manage-users-empty">No audit events yet.</div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      ) : null}
                    </div>
                  </div>
                </section>

                <aside className="panel">
                  <div className="panel__inner">
                    <div className="panel__heading">
                      <div>
                        <h3>User Editor</h3>
                        <p>Update RBAC roles for the selected user.</p>
                      </div>
                    </div>

                    {activeUser ? (
                      <div className="status-card">
                        <span>Selected User</span>
                        <strong>{activeUser.username}</strong>
                        <p className="dashboard-subcopy">{activeUser.azureUserId}</p>
                      </div>
                    ) : (
                      <p className="inline-note">Select a user and click Roles to edit assignments.</p>
                    )}

                    {activeUser ? (
                      <div className="manage-users-form" style={{ marginTop: 12 }}>
                        <label className="field">
                          <span className="field__label">Roles</span>
                          <textarea
                            value={draftRoles}
                            onChange={(event) => setDraftRoles(event.target.value)}
                            placeholder="Reader, Contributor"
                          />
                        </label>
                        <p className="inline-note">Separate multiple roles with commas or new lines.</p>
                        <div className="button-row" style={{ marginTop: 8 }}>
                          <button
                            type="button"
                            className="btn btn--primary"
                            onClick={handleSaveRoles}
                            disabled={saving}
                          >
                            {saving ? 'Saving...' : 'Save Roles'}
                          </button>
                          <button
                            type="button"
                            className="btn btn--secondary"
                            onClick={() => {
                              setActiveUserId('');
                              setDraftRoles('');
                            }}
                            disabled={saving}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </aside>
              </section>
            </>
          ) : (
            <section className="panel">
              <div className="panel__inner">
                <div className="manage-users-empty">
                  Select a resource group to inspect users and monitoring logs.
                </div>
              </div>
            </section>
          )}
        </section>
      </section>
    </main>
  );
}
