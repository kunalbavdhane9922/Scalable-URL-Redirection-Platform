import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Link as LinkIcon,
  QrCode,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { shortenUrl } from '../api/client.js';
import { useSession } from '../hooks/useSession.jsx';
import { Banner, CopyButton, FieldError } from './ui.jsx';

const EXPIRY_PRESETS = [
  { id: 'never', label: 'Never' },
  { id: '1h', label: '1 hour' },
  { id: '24h', label: '24 hours' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'custom', label: 'Custom' },
];

const PRESET_MS = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function isHttpUrl(value) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function ShortenForm({ compact = false, onCreated, showManageLink = false }) {
  const { user } = useSession();
  const [url, setUrl] = useState('');
  const [alias, setAlias] = useState('');
  const [expiry, setExpiry] = useState('never');
  const [customDate, setCustomDate] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [result, setResult] = useState(null);
  const [showQr, setShowQr] = useState(false);

  const minDate = useMemo(() => {
    const d = new Date(Date.now() + 5 * 60 * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }, []);

  const reset = () => {
    setUrl('');
    setAlias('');
    setExpiry('never');
    setCustomDate('');
    setError('');
    setFieldErrors({});
    setResult(null);
    setShowQr(false);
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    const nextErrors = {};

    if (!url.trim()) nextErrors.url = 'Paste a destination URL to continue.';
    else if (!isHttpUrl(url)) nextErrors.url = 'Use a full http:// or https:// URL.';

    if (alias.trim() && !/^[A-Za-z0-9_-]{3,32}$/.test(alias.trim())) {
      nextErrors.alias = 'Aliases use 3–32 letters, numbers, hyphens, or underscores.';
    }

    if (expiry === 'custom' && !customDate) {
      nextErrors.expiry = 'Pick a future expiration date.';
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    let expiresAt = null;
    if (expiry === 'custom') expiresAt = new Date(customDate).toISOString();
    else if (PRESET_MS[expiry]) expiresAt = new Date(Date.now() + PRESET_MS[expiry]).toISOString();

    setSubmitting(true);
    try {
      const created = await shortenUrl({
        url: url.trim(),
        customAlias: alias.trim() || undefined,
        expiresAt,
      });
      setResult(created);
      setShowQr(false);
      onCreated?.(created);
    } catch (err) {
      setError(err.message || 'Could not shorten that URL.');
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className={`shorten-result ${compact ? 'is-compact' : ''}`}>
        <div className="result-head">
          <span className="result-check"><CheckCircle2 size={18} /></span>
          <div>
            <h3>Your short link is ready</h3>
            <p className="muted">
              {result.owned
                ? 'Saved to your account — manage it from your dashboard.'
                : 'Redirects are live immediately. Sign in to keep it in your history.'}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={reset} aria-label="Create another link">
            <X size={18} />
          </button>
        </div>

        <div className="result-link-row">
          <a className="result-link" href={result.shortUrl} target="_blank" rel="noreferrer">
            {result.shortUrl}
            <ExternalLink size={15} />
          </a>
          <div className="result-actions">
            <CopyButton value={result.shortUrl} label="Copy link" className="btn btn-primary btn-sm" />
            <button
              type="button"
              className={`btn btn-ghost btn-sm ${showQr ? 'is-active' : ''}`}
              onClick={() => setShowQr((v) => !v)}
            >
              <QrCode size={14} />
              <span>{showQr ? 'Hide QR' : 'QR code'}</span>
            </button>
          </div>
        </div>

        <p className="result-destination">
          <span>Destination</span>
          {result.originalUrl}
        </p>

        {showQr ? (
          <div className="qr-panel">
            <div className="qr-card">
              <QRCodeSVG value={result.shortUrl} size={168} bgColor="#ffffff" fgColor="#0b1220" level="M" />
            </div>
            <div>
              <h4>Scan to open</h4>
              <p className="muted">
                Great for slides, packaging, and print. The code points at the live short link.
              </p>
            </div>
          </div>
        ) : null}

        <div className="result-footer">
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
            <Wand2 size={14} />
            Shorten another
          </button>
          {result.owned || user ? (
            <Link className="btn btn-soft btn-sm" to="/dashboard">
              Manage links
              <ArrowRight size={14} />
            </Link>
          ) : showManageLink ? (
            <Link className="btn btn-soft btn-sm" to="/login?next=%2Fdashboard">
              Sign in to save it
              <ArrowRight size={14} />
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form className={`shorten-form ${compact ? 'is-compact' : ''}`} onSubmit={onSubmit} noValidate>
      <div className="shorten-row">
        <div className={`shorten-input ${fieldErrors.url ? 'has-error' : ''}`}>
          <LinkIcon size={18} className="shorten-input-icon" />
          <input
            type="url"
            inputMode="url"
            placeholder="Paste a long URL, e.g. https://example.com/campaign/2026"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (fieldErrors.url) setFieldErrors((f) => ({ ...f, url: undefined }));
            }}
            aria-label="Destination URL"
            aria-invalid={Boolean(fieldErrors.url)}
            autoComplete="off"
            spellCheck="false"
          />
        </div>
        <button type="submit" className="btn btn-primary shorten-submit" disabled={submitting}>
          {submitting ? 'Shortening…' : 'Shorten'}
          {!submitting ? <ArrowRight size={16} /> : null}
        </button>
      </div>

      <FieldError>{fieldErrors.url}</FieldError>

      <div className="shorten-meta">
        <button type="button" className="link-button" onClick={() => setAdvanced((v) => !v)}>
          <Sparkles size={14} />
          {advanced ? 'Hide options' : 'Custom alias & expiration'}
        </button>
        <span className="shorten-note">
          {user
            ? `Saved to ${user.email}`
            : 'No account needed · sign in to save your history'}
        </span>
      </div>

      {advanced ? (
        <div className="advanced-grid">
          <label className="field">
            <span className="field-label">Custom alias</span>
            <div className={`field-input ${fieldErrors.alias ? 'has-error' : ''}`}>
              <span className="prefix">/</span>
              <input
                type="text"
                placeholder="spring-launch"
                value={alias}
                maxLength={32}
                onChange={(e) => {
                  setAlias(e.target.value);
                  if (fieldErrors.alias) setFieldErrors((f) => ({ ...f, alias: undefined }));
                }}
                spellCheck="false"
              />
            </div>
            <FieldError>{fieldErrors.alias}</FieldError>
          </label>

          <label className="field">
            <span className="field-label">Expires</span>
            <div className="field-input">
              <CalendarClock size={15} className="field-icon" />
              <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                {EXPIRY_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </select>
            </div>
            {expiry === 'custom' ? (
              <input
                type="datetime-local"
                className="date-input"
                min={minDate}
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
              />
            ) : null}
            <FieldError>{fieldErrors.expiry}</FieldError>
          </label>
        </div>
      ) : null}

      <Banner tone="error">{error}</Banner>
    </form>
  );
}
