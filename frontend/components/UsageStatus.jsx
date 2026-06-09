'use client';

import { useEffect, useState } from 'react';
import { getUsageStatus } from '../services/api';

const formatMinutes = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours > 0 && mins > 0) {
    return `${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${mins}m`;
};

export default function UsageStatus({ requestId, userId }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!requestId || !userId) {
      setLoading(false);
      return;
    }

    const fetchStatus = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await getUsageStatus(requestId, userId);
        setStatus(response?.data || null);
      } catch (err) {
        setError(err.message || 'Failed to load usage status');
        console.error('Error fetching usage status:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();

    // Refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000);

    return () => clearInterval(interval);
  }, [requestId, userId]);

  if (loading) {
    return (
      <div className="surface" style={{ padding: 16 }}>
        <p className="inline-note">Loading usage status...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="surface" style={{ padding: 16 }}>
        <p className="inline-note" style={{ color: 'var(--color-error, #dc2626)' }}>
          {error}
        </p>
      </div>
    );
  }

  if (!status || !status.enableDailyUsage) {
    return null; // Don't show if daily usage is not enabled
  }

  const percentUsed = status.dailyLimitMinutes > 0 
    ? Math.min(100, (status.usedMinutes / status.dailyLimitMinutes) * 100)
    : 0;

  return (
    <div className="surface" style={{ padding: 16 }}>
      <div className="panel__heading" style={{ marginBottom: 14 }}>
        <div>
          <h3>Daily Usage Status</h3>
          <p>Your usage for today</p>
        </div>
        {status.blocked && (
          <span className="helper-badge" style={{ backgroundColor: 'var(--color-error, #dc2626)', color: '#fff' }}>
            Blocked
          </span>
        )}
        {status.hasActiveSession && !status.blocked && (
          <span className="helper-badge" style={{ backgroundColor: 'var(--color-success, #16a34a)', color: '#fff' }}>
            Active Session
          </span>
        )}
      </div>

      <div className="step-stack" style={{ gap: 12 }}>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <div>
            <p className="field__label" style={{ fontSize: '0.875rem', marginBottom: 4 }}>
              Daily Limit
            </p>
            <p style={{ fontSize: '1.25rem', fontWeight: '600', margin: 0 }}>
              {formatMinutes(status.dailyLimitMinutes)}
            </p>
          </div>

          <div>
            <p className="field__label" style={{ fontSize: '0.875rem', marginBottom: 4 }}>
              Used Today
            </p>
            <p style={{ fontSize: '1.25rem', fontWeight: '600', margin: 0 }}>
              {formatMinutes(status.usedMinutes)}
            </p>
          </div>

          <div>
            <p className="field__label" style={{ fontSize: '0.875rem', marginBottom: 4 }}>
              Remaining
            </p>
            <p 
              style={{ 
                fontSize: '1.25rem', 
                fontWeight: '600', 
                margin: 0,
                color: status.remainingMinutes <= 0 ? 'var(--color-error, #dc2626)' : 'inherit'
              }}
            >
              {status.remainingMinutes !== null ? formatMinutes(status.remainingMinutes) : 'N/A'}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div 
            style={{ 
              width: '100%', 
              height: 8, 
              backgroundColor: 'var(--color-surface-secondary, #f3f4f6)', 
              borderRadius: 4,
              overflow: 'hidden'
            }}
          >
            <div 
              style={{ 
                width: `${percentUsed}%`, 
                height: '100%', 
                backgroundColor: percentUsed >= 100 
                  ? 'var(--color-error, #dc2626)' 
                  : percentUsed >= 80 
                    ? 'var(--color-warning, #f59e0b)' 
                    : 'var(--color-success, #16a34a)',
                transition: 'width 0.3s ease'
              }}
            />
          </div>
          <p className="inline-note" style={{ marginTop: 4 }}>
            {percentUsed.toFixed(0)}% of daily limit used
          </p>
        </div>

        {status.blocked && (
          <div 
            className="error-box" 
            style={{ 
              padding: 12, 
              backgroundColor: 'var(--color-error-bg, #fef2f2)', 
              border: '1px solid var(--color-error, #dc2626)',
              borderRadius: 4
            }}
          >
            <p style={{ margin: 0, fontSize: '0.875rem' }}>
              <strong>Access Blocked:</strong> You have exceeded your daily usage limit. 
              Access will be restored at midnight.
            </p>
            {status.blockedUntil && (
              <p style={{ margin: '4px 0 0 0', fontSize: '0.875rem' }}>
                Blocked until: {new Date(status.blockedUntil).toLocaleString()}
              </p>
            )}
          </div>
        )}

        {!status.blocked && status.remainingMinutes <= 30 && status.remainingMinutes > 0 && (
          <div 
            style={{ 
              padding: 12, 
              backgroundColor: 'var(--color-warning-bg, #fffbeb)', 
              border: '1px solid var(--color-warning, #f59e0b)',
              borderRadius: 4
            }}
          >
            <p style={{ margin: 0, fontSize: '0.875rem' }}>
              <strong>Warning:</strong> You have less than {formatMinutes(status.remainingMinutes)} remaining today.
            </p>
          </div>
        )}

        {status.expired && (
          <div 
            className="error-box" 
            style={{ 
              padding: 12, 
              backgroundColor: 'var(--color-error-bg, #fef2f2)', 
              border: '1px solid var(--color-error, #dc2626)',
              borderRadius: 4
            }}
          >
            <p style={{ margin: 0, fontSize: '0.875rem' }}>
              <strong>Expired:</strong> This access request has expired.
            </p>
            {status.expiryDate && (
              <p style={{ margin: '4px 0 0 0', fontSize: '0.875rem' }}>
                Expired on: {new Date(status.expiryDate).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
