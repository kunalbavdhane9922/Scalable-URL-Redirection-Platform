import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Check,
  Download,
  ExternalLink,
  Globe2,
  Laptop,
  Link2,
  MousePointerClick,
  Pencil,
  QrCode,
  Trash2,
  X,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { disableLink, fetchLinkDetails, updateLink } from '../api/client.js';
import { Banner, CopyButton, Spinner, StatusPill } from './ui.jsx';
import ClicksChart from './ClicksChart.jsx';
import { formatDateTime, formatDate, expiryLabel, timeAgo } from '../lib/format.js';

const DIMENSION_META = {
  device: { label: 'Devices', icon: Laptop },
  country: { label: 'Countries', icon: Globe2 },
  referrer: { label: 'Referrers', icon: Link2 },
};

function groupBreakdown(rows) {
  const groups = {};
  for (const row of rows || []) {
    if (!groups[row.dimension]) groups[row.dimension] = [];
    groups[row.dimension].push(row);
  }
  return groups;
}

function Breakdown({ rows }) {
  const groups = groupBreakdown(rows);
  const entries = Object.entries(groups);

  if (entries.length === 0) {
    return (
      <p className="muted small">
        Device, country, and referrer breakdowns appear after the first clicks are processed.
      </p>
    );
  }

  return (
    <div className="breakdown-grid">
      {entries.map(([dimension, items]) => {
        const meta = DIMENSION_META[dimension] || { label: dimension, icon: Globe2 };
        const Icon = meta.icon;
        const total = items.reduce((sum, item) => sum + item.count, 0) || 1;
        return (
          <div className="breakdown-card" key={dimension}>
            <div className="breakdown-title">
              <Icon size={15} />
              {meta.label}
            </div>
            <ul className="breakdown-list">
              {items.slice(0, 5).map((item) => (
                <li key={item.value}>
                  <span className="breakdown-value">{item.value || 'unknown'}</span>
                  <span className="breakdown-count">{item.count.toLocaleString()}</span>
                  <span className="breakdown-track">
                    <span style={{ width: `${Math.max(4, (item.count / total) * 100)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default function LinkDetailsModal({ code, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editingExpiry, setEditingExpiry] = useState(false);
  const [expiryMode, setExpiryMode] = useState('never');
  const [customExpiry, setCustomExpiry] = useState('');
  const [savingExpiry, setSavingExpiry] = useState(false);
  const [expiryError, setExpiryError] = useState('');
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const qrRef = useRef(null);

  const load = async () => {
    setLoading(true);
    setError('');
    setEditing(false);
    setEditingExpiry(false);
    setExpiryMode('keep');
    setCustomExpiry('');
    setExpiryError('');
    try {
      const details = await fetchLinkDetails(code);
      setData(details);
      setNewUrl(details.originalUrl || '');
      setExpiryMode(details.expiresAt ? 'keep' : 'never');
    } catch (err) {
      setError(err.message || 'Could not load that link.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (code) load();
  }, [code]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const copy = async () => {
    if (!data?.shortUrl) return;
    try {
      await navigator.clipboard.writeText(data.shortUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  const downloadQr = () => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${code}-qr.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const saveUrl = async (event) => {
    event.preventDefault();
    setEditError('');
    try {
      const parsed = new URL(newUrl.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad scheme');
    } catch {
      setEditError('Enter a full http:// or https:// URL.');
      return;
    }

    setSaving(true);
    try {
      const updated = await updateLink(code, { url: newUrl.trim() });
      setData((prev) => ({ ...prev, originalUrl: updated.originalUrl, updatedAt: updated.updatedAt }));
      setNewUrl(updated.originalUrl);
      setEditing(false);
      onChanged?.();
    } catch (err) {
      setEditError(err.message || 'Could not update that link.');
    } finally {
      setSaving(false);
    }
  };

  const saveExpiry = async (event) => {
    event.preventDefault();
    setExpiryError('');

    if (expiryMode === 'keep') {
      setEditingExpiry(false);
      return;
    }

    let expiresAt = null;
    if (expiryMode === 'custom') {
      if (!customExpiry) {
        setExpiryError('Pick a date and time.');
        return;
      }
      const date = new Date(customExpiry);
      if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
        setExpiryError('Choose a future date and time.');
        return;
      }
      expiresAt = date.toISOString();
    } else if (expiryMode !== 'never') {
      const offsets = {
        '1h': 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
      };
      expiresAt = new Date(Date.now() + offsets[expiryMode]).toISOString();
    }

    setSavingExpiry(true);
    try {
      const updated = await updateLink(code, { expiresAt });
      setData((prev) => ({ ...prev, expiresAt: updated.expiresAt, updatedAt: updated.updatedAt }));
      setEditingExpiry(false);
      onChanged?.();
    } catch (err) {
      setExpiryError(err.message || 'Could not update the expiry.');
    } finally {
      setSavingExpiry(false);
    }
  };

  const confirmDisable = async () => {
    setDisabling(true);
    try {
      await disableLink(code);
      setData((prev) => (prev ? { ...prev, status: 'disabled' } : prev));
      setConfirmingDisable(false);
      onChanged?.();
    } catch (err) {
      setError(err.message || 'Could not disable that link.');
    } finally {
      setDisabling(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="link-modal-title">
        <div className="modal-head">
          <div className="modal-title-group">
            <span className="code-pill">/{code}</span>
            {data ? <StatusPill status={data.status} /> : null}
            <h2 id="link-modal-title">Link details</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </div>

        {loading ? (
          <div className="modal-loading"><Spinner label="Loading link" /></div>
        ) : error && !data ? (
          <div className="modal-body"><Banner tone="error">{error}</Banner></div>
        ) : data ? (
          <div className="modal-body">
            {/* Short URL + QR */}
            <div className="detail-hero">
              <div className="detail-link-block">
                <span className="detail-label">Short URL</span>
                <div className="detail-link-row">
                  <a href={data.shortUrl} target="_blank" rel="noreferrer" className="detail-short-url">
                    {data.shortUrl.replace(/^https?:\/\//, '')}
                  </a>
                  <div className="detail-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
                      {copied ? <Check size={14} /> : <Link2 size={14} />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      className={`btn btn-ghost btn-sm ${showQr ? 'is-active' : ''}`}
                      onClick={() => setShowQr((v) => !v)}
                    >
                      <QrCode size={14} />
                      QR
                    </button>
                    <a href={data.shortUrl} target="_blank" rel="noreferrer" className="btn btn-soft btn-sm">
                      <ExternalLink size={14} />
                      Test
                    </a>
                  </div>
                </div>
              </div>

              {showQr ? (
                <div className="detail-qr" ref={qrRef}>
                  <QRCodeCanvas
                    value={data.shortUrl}
                    size={148}
                    bgColor="#ffffff"
                    fgColor="#0b1220"
                    level="M"
                    includeMargin
                  />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={downloadQr}>
                    <Download size={14} />
                    PNG
                  </button>
                </div>
              ) : null}
            </div>

            {/* Stats */}
            <div className="detail-stats">
              <div className="detail-stat">
                <MousePointerClick size={16} />
                <strong>{(data.clickCount || 0).toLocaleString()}</strong>
                <span>Total clicks</span>
              </div>
              <div className="detail-stat">
                <CalendarDays size={16} />
                <strong>{formatDate(data.createdAt)}</strong>
                <span>Created</span>
              </div>
              <div className="detail-stat">
                <ArrowUpRight size={16} />
                <strong>{data.lastClickedAt ? timeAgo(data.lastClickedAt) : '—'}</strong>
                <span>Last click</span>
              </div>
              <div className="detail-stat">
                <CalendarDays size={16} />
                <strong>{expiryLabel(data.expiresAt)}</strong>
                <span>Expires</span>
              </div>
            </div>

            {/* Destination */}
            <section className="detail-section">
              <div className="detail-section-head">
                <h3>Destination</h3>
                {data.status === 'active' && !editing ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                    <Pencil size={14} />
                    Retarget
                  </button>
                ) : null}
              </div>

              {editing ? (
                <form className="retarget-form" onSubmit={saveUrl}>
                  <div className="field-input">
                    <input
                      type="url"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      autoFocus
                      spellCheck="false"
                    />
                  </div>
                  <Banner tone="error">{editError}</Banner>
                  <div className="retarget-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)} disabled={saving}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                      {saving ? 'Saving…' : 'Save destination'}
                    </button>
                  </div>
                  <p className="muted small">
                    Commits to PostgreSQL, evicts Redis L2, and broadcasts eviction to every app instance.
                  </p>
                </form>
              ) : (
                <a href={data.originalUrl} target="_blank" rel="noreferrer" className="destination-link">
                  {data.originalUrl}
                  <ExternalLink size={14} />
                </a>
              )}
            </section>

            {/* Expiry */}
            <section className="detail-section">
              <div className="detail-section-head">
                <h3>Expiry</h3>
                {data.status === 'active' && !editingExpiry ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingExpiry(true)}>
                    <CalendarDays size={14} />
                    Change
                  </button>
                ) : null}
              </div>

              {editingExpiry ? (
                <form className="expiry-form" onSubmit={saveExpiry}>
                  <div className="expiry-presets" role="group" aria-label="Expiry options">
                    {[
                      ...(data.expiresAt ? [['keep', 'Keep current']] : []),
                      ['never', 'Never'],
                      ['1h', '1 hour'],
                      ['24h', '24 hours'],
                      ['7d', '7 days'],
                      ['30d', '30 days'],
                      ['custom', 'Custom'],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={`filter-chip ${expiryMode === id ? 'is-active' : ''}`}
                        onClick={() => setExpiryMode(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {expiryMode === 'custom' ? (
                    <input
                      type="datetime-local"
                      className="date-input"
                      min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000 + 5 * 60000).toISOString().slice(0, 16)}
                      value={customExpiry}
                      onChange={(e) => setCustomExpiry(e.target.value)}
                    />
                  ) : null}

                  <Banner tone="error">{expiryError}</Banner>
                  <div className="retarget-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setEditingExpiry(false)}
                      disabled={savingExpiry}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={savingExpiry}>
                      {savingExpiry ? 'Saving…' : 'Save expiry'}
                    </button>
                  </div>
                  <p className="muted small">
                    Expired links answer 410 Gone and are dropped from every cache tier automatically.
                  </p>
                </form>
              ) : (
                <p className="expiry-current">
                  <CalendarDays size={15} />
                  {data.expiresAt
                    ? `Expires ${formatDateTime(data.expiresAt)}`
                    : 'This link never expires.'}
                </p>
              )}
            </section>

            {/* Analytics */}
            <section className="detail-section">
              <ClicksChart rows={(data.dailyClicks || []).map((d) => ({ date: d.click_date, clicks: d.click_count }))} />
              <Breakdown rows={data.breakdown} />
            </section>

            {/* Danger zone */}
            {data.status === 'active' ? (
              <section className="danger-zone">
                <div className="danger-copy">
                  <span className="danger-icon"><AlertTriangle size={17} /></span>
                  <div>
                    <h3>Disable this link</h3>
                    <p>Visitors will get 410 Gone immediately. Caches are evicted across the fleet.</p>
                  </div>
                </div>
                {confirmingDisable ? (
                  <div className="danger-confirm">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingDisable(false)} disabled={disabling}>
                      Keep it
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={confirmDisable} disabled={disabling}>
                      {disabling ? 'Disabling…' : 'Yes, disable'}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setConfirmingDisable(true)}>
                    <Trash2 size={14} />
                    Disable
                  </button>
                )}
              </section>
            ) : null}

            {error ? <Banner tone="error">{error}</Banner> : null}

            <div className="modal-foot">
              <span className="muted small">Updated {formatDateTime(data.updatedAt)}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
