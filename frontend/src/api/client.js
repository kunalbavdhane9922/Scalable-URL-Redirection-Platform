/**
 * API client for interacting with the URL shortener backend service.
 */

const BASE_API = '/api';

export async function shortenUrl(url, expiresAt = null) {
  const response = await fetch(`${BASE_API}/shorten`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      expiresAt: expiresAt || null,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.error || 'Failed to shorten URL');
  }
  return data;
}

export async function fetchLinks(limit = 50) {
  const response = await fetch(`${BASE_API}/links?limit=${limit}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch links');
  }
  return data;
}

export async function fetchLinkDetails(code) {
  const response = await fetch(`${BASE_API}/links/${encodeURIComponent(code)}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch link details');
  }
  return data;
}

export async function updateLink(code, url) {
  const response = await fetch(`${BASE_API}/links/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update link');
  }
  return data;
}

export async function disableLink(code) {
  const response = await fetch(`${BASE_API}/links/${encodeURIComponent(code)}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to disable link');
  }
  return true;
}

export async function fetchHealth() {
  const response = await fetch('/health');
  const data = await response.json();
  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

export async function fetchMetrics() {
  const response = await fetch('/health/metrics');
  if (!response.ok) {
    throw new Error('Metrics endpoint not accessible');
  }
  return response.json();
}
