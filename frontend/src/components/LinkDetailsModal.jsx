import React, { useState, useEffect } from 'react';
import { X, ExternalLink, Copy, Check, MousePointerClick, Calendar, Clock, Edit2, Trash2, AlertTriangle } from 'lucide-react';
import { fetchLinkDetails, updateLink, disableLink } from '../api/client.js';

export default function LinkDetailsModal({ code, onClose, onLinkUpdated }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [updating, setUpdating] = useState(false);
  const [editError, setEditError] = useState(null);

  // Disable state
  const [disabling, setDisabling] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchLinkDetails(code);
      setData(res);
      setNewUrl(res.originalUrl || '');
    } catch (err) {
      setError(err.message || 'Failed to load link details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (code) {
      loadData();
    }
  }, [code]);

  const handleCopy = () => {
    if (!data?.shortUrl) return;
    navigator.clipboard.writeText(data.shortUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    setEditError(null);
    setUpdating(true);
    try {
      await updateLink(code, newUrl);
      setIsEditing(false);
      await loadData();
      if (onLinkUpdated) onLinkUpdated();
    } catch (err) {
      setEditError(err.message || 'Failed to update destination');
    } finally {
      setUpdating(false);
    }
  };

  const handleDisable = async () => {
    if (!window.confirm(`Are you sure you want to disable link "${code}"? Once disabled, visitors will receive 410 Gone.`)) {
      return;
    }
    setDisabling(true);
    try {
      await disableLink(code);
      await loadData();
      if (onLinkUpdated) onLinkUpdated();
    } catch (err) {
      setError(err.message || 'Failed to disable link');
    } finally {
      setDisabling(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="code-pill">{code}</span>
            <h3 className="modal-title">Link Intelligence & Controls</h3>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="Close modal">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="modal-loading">
            <span className="spinner"></span>
            <p>Retrieving link metadata & analytics...</p>
          </div>
        ) : error ? (
          <div className="alert alert-error">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        ) : data ? (
          <div className="modal-body">
            {/* Quick Actions Header */}
            <div className="link-summary-box">
              <div className="summary-left">
                <span className="summary-label">Short URL</span>
                <span className="summary-value">{data.shortUrl}</span>
              </div>
              <div className="summary-actions">
                <button onClick={handleCopy} className="btn-secondary btn-sm">
                  {copied ? <Check size={14} className="text-emerald" /> : <Copy size={14} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                <a
                  href={data.shortUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary btn-sm"
                >
                  <ExternalLink size={14} />
                  <span>Test 302</span>
                </a>
              </div>
            </div>

            {/* Status and Analytics grid */}
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-label">Status</span>
                <span className={`status-badge status-${data.status}`}>
                  {data.status.toUpperCase()}
                </span>
              </div>

              <div className="stat-card">
                <span className="stat-label">Total Clicks</span>
                <div className="click-counter">
                  <MousePointerClick size={16} className="text-blue" />
                  <span className="click-number">{data.clickCount || 0}</span>
                </div>
              </div>

              <div className="stat-card">
                <span className="stat-label">Created At</span>
                <span className="stat-subtext">
                  {new Date(data.createdAt).toLocaleDateString()} {new Date(data.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <div className="stat-card">
                <span className="stat-label">Expires At</span>
                <span className="stat-subtext">
                  {data.expiresAt ? new Date(data.expiresAt).toLocaleString() : 'Never (Permanent)'}
                </span>
              </div>
            </div>

            {/* Destination URL & Edit */}
            <div className="destination-panel">
              <div className="panel-header">
                <span className="panel-title">Destination URL</span>
                {data.status === 'active' && !isEditing && (
                  <button onClick={() => setIsEditing(true)} className="btn-text">
                    <Edit2 size={14} />
                    <span>Change Target (302 Invalidation)</span>
                  </button>
                )}
              </div>

              {isEditing ? (
                <form onSubmit={handleUpdate} className="edit-form">
                  <input
                    type="text"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    className="url-input"
                    placeholder="https://..."
                    disabled={updating}
                  />
                  {editError && <div className="alert alert-error">{editError}</div>}
                  <div className="edit-buttons">
                    <button type="button" onClick={() => setIsEditing(false)} className="btn-secondary btn-sm" disabled={updating}>
                      Cancel
                    </button>
                    <button type="submit" className="btn-primary btn-sm" disabled={updating}>
                      {updating ? 'Saving & Invalidating Caches...' : 'Save New Destination'}
                    </button>
                  </div>
                  <span className="hint-text">
                    Saving updates PostgreSQL atomically, evicts Redis L2, and broadcasts cache eviction to all Fastify L1 instances via Redis Pub/Sub.
                  </span>
                </form>
              ) : (
                <div className="current-destination">
                  <a href={data.originalUrl} target="_blank" rel="noopener noreferrer" className="original-link">
                    {data.originalUrl}
                    <ExternalLink size={14} />
                  </a>
                </div>
              )}
            </div>

            {/* Click breakdown by date */}
            <div className="analytics-breakdown">
              <span className="panel-title">Recent Daily Clicks (Asynchronous Workers)</span>
              {data.dailyClicks && data.dailyClicks.length > 0 ? (
                <div className="daily-table">
                  {data.dailyClicks.map((item, idx) => (
                    <div key={idx} className="daily-row">
                      <span className="daily-date">{item.click_date?.slice(0, 10)}</span>
                      <span className="daily-count">{item.click_count} clicks</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-subtext">No clicks recorded yet. Open the short link to record click analytics.</p>
              )}
            </div>

            {/* Danger zone / Disable */}
            {data.status === 'active' && (
              <div className="danger-zone">
                <div>
                  <span className="danger-title">Disable Link</span>
                  <p className="danger-desc">Evicts link from all caches and marks as disabled. Visitors receive 410 Gone.</p>
                </div>
                <button
                  onClick={handleDisable}
                  className="btn-danger btn-sm"
                  disabled={disabling}
                >
                  <Trash2 size={14} />
                  <span>{disabling ? 'Disabling...' : 'Disable Link'}</span>
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
