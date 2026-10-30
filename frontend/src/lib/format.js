export function compactNumber(value) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (seconds < 45) return 'just now';
  if (seconds < 90) return '1 min ago';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 5400) return '1 hr ago';
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hrs ago`;
  if (seconds < 172800) return 'yesterday';
  if (seconds < 2592000) return `${Math.round(seconds / 86400)} days ago`;
  return formatDate(value);
}

export function expiryLabel(expiresAt) {
  if (!expiresAt) return 'Never';
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return '—';
  return date < new Date() ? `Expired ${formatDate(expiresAt)}` : formatDate(expiresAt);
}
