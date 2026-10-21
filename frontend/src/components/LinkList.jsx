import React, { useState } from 'react';
import { ExternalLink, Copy, Check, MousePointerClick, RefreshCw, Search, MoreHorizontal } from 'lucide-react';

export default function LinkList({ links, loading, onRefresh, onSelectLink }) {
  const [copiedCode, setCopiedCode] = useState(null);
  const [filter, setFilter] = useState('');

  const handleCopy = (e, url, code) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const filteredLinks = links.filter((link) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      link.short_code.toLowerCase().includes(q) ||
      link.original_url.toLowerCase().includes(q)
    );
  });

  return (
    <div className="card list-card">
      <div className="list-header">
        <div>
          <h3 className="section-title">Active & Managed Links</h3>
          <p className="section-subtitle">Real-time status, click metrics, and invalidation controls</p>
        </div>

        <div className="list-controls">
          <div className="search-box">
            <Search size={16} className="text-muted" />
            <input
              type="text"
              placeholder="Filter by code or destination..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="search-input"
            />
          </div>

          <button onClick={onRefresh} className="btn-icon" title="Refresh links" disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {loading && links.length === 0 ? (
        <div className="list-empty">
          <span className="spinner"></span>
          <p>Loading managed links...</p>
        </div>
      ) : filteredLinks.length === 0 ? (
        <div className="list-empty">
          <p className="empty-title">{filter ? 'No links match your filter' : 'No shortened links created yet'}</p>
          <p className="empty-desc">
            {filter
              ? 'Try searching with a different short code or destination URL.'
              : 'Paste a destination URL above to generate your first high-speed shortened link.'}
          </p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="links-table">
            <thead>
              <tr>
                <th>Short Code</th>
                <th>Destination URL</th>
                <th>Status</th>
                <th>Clicks</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLinks.map((link) => {
                const shortUrl = `${window.location.origin}/${link.short_code}`;
                const isCopied = copiedCode === link.short_code;

                return (
                  <tr
                    key={link.id}
                    onClick={() => onSelectLink(link.short_code)}
                    className="link-row"
                  >
                    <td>
                      <span className="code-text">{link.short_code}</span>
                    </td>
                    <td className="url-cell">
                      <span className="url-truncated" title={link.original_url}>
                        {link.original_url}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge status-${link.status}`}>
                        {link.status}
                      </span>
                    </td>
                    <td>
                      <div className="click-pill">
                        <MousePointerClick size={13} />
                        <span>{link.click_count || 0}</span>
                      </div>
                    </td>
                    <td className="date-cell">
                      {new Date(link.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      <div className="actions-cell" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => handleCopy(e, shortUrl, link.short_code)}
                          className="btn-action"
                          title="Copy short link"
                        >
                          {isCopied ? <Check size={14} className="text-emerald" /> : <Copy size={14} />}
                        </button>
                        <a
                          href={shortUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-action"
                          title="Test 302 redirect"
                        >
                          <ExternalLink size={14} />
                        </a>
                        <button
                          onClick={() => onSelectLink(link.short_code)}
                          className="btn-action"
                          title="View details & edit"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
