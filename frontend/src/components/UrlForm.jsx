import React, { useState } from 'react';
import { ArrowRight, Copy, Check, ExternalLink, Calendar, AlertCircle, Sparkles } from 'lucide-react';
import { shortenUrl } from '../api/client.js';

export default function UrlForm({ onUrlCreated }) {
  const [url, setUrl] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [lastCreated, setLastCreated] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const trimmed = url.trim();
    if (!trimmed) {
      setError('Please enter a destination URL.');
      return;
    }

    try {
      const parsed = new URL(trimmed);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        setError('URL scheme must be http:// or https://');
        return;
      }
    } catch {
      setError('Please enter a valid URL including http:// or https://');
      return;
    }

    setLoading(true);
    try {
      const result = await shortenUrl(trimmed, expiresAt ? new Date(expiresAt).toISOString() : null);
      setLastCreated(result);
      setUrl('');
      setExpiresAt('');
      setShowOptions(false);
      if (onUrlCreated) {
        onUrlCreated(result);
      }
    } catch (err) {
      setError(err.message || 'Failed to shorten URL');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!lastCreated?.shortUrl) return;
    navigator.clipboard.writeText(lastCreated.shortUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card form-card">
      <div className="card-header">
        <div className="card-badge">
          <Sparkles size={14} className="text-blue" />
          <span>L1 LRU + Shared Redis + PostgreSQL Persistence</span>
        </div>
        <h2 className="card-title">Shorten a Destination URL</h2>
        <p className="card-description">
          Generated short URLs use collision-resistant codes and resolve via a two-level cache (sub-millisecond L1 and low-latency L2).
        </p>
      </div>

      <form onSubmit={handleSubmit} className="shorten-form">
        <div className="input-group">
          <input
            type="text"
            className="url-input"
            placeholder="Paste your long destination URL (e.g. https://example.com/long/path)..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
          />
          <button type="submit" className="btn-primary" disabled={loading || !url.trim()}>
            {loading ? (
              <span className="spinner"></span>
            ) : (
              <>
                <span>Shorten</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </div>

        <div className="form-toggle-row">
          <button
            type="button"
            className="text-btn"
            onClick={() => setShowOptions(!showOptions)}
          >
            <Calendar size={14} />
            <span>{showOptions ? 'Hide Expiration Options' : 'Set Expiration Date (Optional)'}</span>
          </button>
        </div>

        {showOptions && (
          <div className="options-panel">
            <label className="form-label">
              <span>Link Expiration Timestamp (UTC)</span>
              <input
                type="datetime-local"
                className="date-input"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
              />
            </label>
            <span className="hint-text">
              Expired links are automatically evicted from caches and return HTTP 410 Gone.
            </span>
          </div>
        )}
      </form>

      {error && (
        <div className="alert alert-error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {lastCreated && (
        <div className="success-banner">
          <div className="success-header">
            <span className="success-tag">Short Link Created</span>
            <span className="code-tag">Code: {lastCreated.shortCode}</span>
          </div>

          <div className="result-row">
            <div className="short-url-box">
              <span className="short-url-text">{lastCreated.shortUrl}</span>
            </div>
            <div className="result-actions">
              <button onClick={handleCopy} className="btn-secondary" title="Copy to clipboard">
                {copied ? <Check size={16} className="text-emerald" /> : <Copy size={16} />}
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
              <a
                href={lastCreated.shortUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
                title="Open short URL to test 302 redirect"
              >
                <ExternalLink size={16} />
                <span>Test 302</span>
              </a>
            </div>
          </div>

          <div className="target-preview">
            <span className="preview-label">Target:</span>
            <span className="preview-url">{lastCreated.originalUrl}</span>
          </div>
        </div>
      )}
    </div>
  );
}
