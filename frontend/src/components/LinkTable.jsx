import { ArrowUpRight, ChevronRight, ExternalLink, Link2, MousePointerClick } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CopyButton, EmptyState, StatusPill } from './ui.jsx';
import { timeAgo } from '../lib/format.js';

export default function LinkTable({ items, loading, onSelect, emptyAction }) {
  if (loading && items.length === 0) {
    return (
      <div className="link-list">
        {[0, 1, 2, 3].map((i) => <div className="link-row skeleton" key={i} />)}
      </div>
    );
  }

  if (!loading && items.length === 0) {
    return (
      <EmptyState
        icon={Link2}
        title="No links here yet"
        action={emptyAction}
      >
        Create your first short link and it will show up here with live click analytics.
      </EmptyState>
    );
  }

  return (
    <div className={`link-list ${loading ? 'is-refreshing' : ''}`}>
      <div className="link-list-head">
        <span>Link</span>
        <span>Status</span>
        <span>Clicks</span>
        <span>Created</span>
        <span aria-hidden="true" />
      </div>

      {items.map((link) => (
        <div className="link-row" key={link.id || link.shortCode}>
          <div className="link-main">
            <span className="link-code">
              <span className="code-dot" />
              /{link.shortCode}
            </span>
            <a
              href={link.originalUrl}
              target="_blank"
              rel="noreferrer"
              className="link-dest"
              title={link.originalUrl}
            >
              {link.originalUrl}
            </a>
          </div>

          <div className="link-cell">
            <StatusPill status={link.status} />
          </div>

          <div className="link-cell link-clicks">
            <MousePointerClick size={14} />
            <span>{(link.clickCount || 0).toLocaleString()}</span>
          </div>

          <div className="link-cell link-created">{timeAgo(link.createdAt)}</div>

          <div className="link-actions">
            <CopyButton value={link.shortUrl} label="" className="icon-button" />
            <a
              href={link.shortUrl}
              target="_blank"
              rel="noreferrer"
              className="icon-button"
              aria-label={`Open ${link.shortCode}`}
            >
              <ExternalLink size={16} />
            </a>
            <button
              type="button"
              className="icon-button"
              onClick={() => onSelect?.(link)}
              aria-label={`View details for ${link.shortCode}`}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TopLinks({ links }) {
  if (!links || links.length === 0) {
    return <p className="muted small">Clicks will rank your top links here.</p>;
  }

  const max = Math.max(1, ...links.map((l) => l.clickCount));

  return (
    <ol className="top-links">
      {links.map((link, index) => (
        <li key={link.shortCode} className="top-link">
          <span className="top-rank">{index + 1}</span>
          <div className="top-link-body">
            <div className="top-link-head">
              <Link to={`/dashboard?link=${encodeURIComponent(link.shortCode)}`} className="top-code">
                /{link.shortCode}
              </Link>
              <span className="top-count">{(link.clickCount || 0).toLocaleString()} clicks</span>
            </div>
            <div className="top-bar">
              <span style={{ width: `${Math.max(4, (link.clickCount / max) * 100)}%` }} />
            </div>
          </div>
          <ArrowUpRight size={14} className="top-arrow" />
        </li>
      ))}
    </ol>
  );
}
