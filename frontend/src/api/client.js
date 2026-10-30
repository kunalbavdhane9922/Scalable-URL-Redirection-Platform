/**
 * API client for the URL redirection platform.
 *
 * Authentication is an HttpOnly session cookie; every request uses
 * `credentials: 'include'` so the same build works against a same-origin edge
 * or a cross-origin API during development.
 */

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const SESSION_EVENT = 'shortly:session';

export class ApiError extends Error {
  constructor(message, { status, code, requestId } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status ?? 0;
    this.code = code ?? 'REQUEST_FAILED';
    this.requestId = requestId;
  }
}

export function emitSessionChange(user) {
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: user }));
}

export function subscribeSession(listener) {
  const handler = (event) => listener(event.detail ?? null);
  window.addEventListener(SESSION_EVENT, handler);
  return () => window.removeEventListener(SESSION_EVENT, handler);
}

/* ── Core request helper ─────────────────────────────────────────── */

async function request(path, { method = 'GET', body, signal, headers = {} } = {}) {
  const finalHeaders = { Accept: 'application/json', ...headers };
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the API. Check your connection or API base URL.', {
      code: 'NETWORK_ERROR',
    });
  }

  if (response.status === 204) return null;

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const message =
      data?.message ||
      (response.status === 401
        ? 'Sign in to continue'
        : response.status === 403
          ? 'You do not have access to this resource'
          : `Request failed (${response.status})`);
    throw new ApiError(message, {
      status: response.status,
      code: data?.error || `HTTP_${response.status}`,
      requestId: data?.requestId,
    });
  }

  return data;
}

/* ── Links ───────────────────────────────────────────────────────── */

export function shortenUrl({ url, customAlias, expiresAt }, options = {}) {
  return request('/api/shorten', {
    method: 'POST',
    body: {
      url,
      ...(customAlias ? { customAlias } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    },
    ...options,
  });
}

export function fetchLinks({ page = 1, limit = 20, q = '', status = '' } = {}, options = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  return request(`/api/links?${params}`, options);
}

export const fetchLinkDetails = (code, options) =>
  request(`/api/links/${encodeURIComponent(code)}`, options);

export function updateLink(code, changes, options = {}) {
  const body = {};
  if (Object.prototype.hasOwnProperty.call(changes, 'url')) body.url = changes.url;
  if (Object.prototype.hasOwnProperty.call(changes, 'expiresAt')) body.expiresAt = changes.expiresAt;
  return request(`/api/links/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body,
    ...options,
  });
}

export const disableLink = (code, options) =>
  request(`/api/links/${encodeURIComponent(code)}`, { method: 'DELETE', ...options });

export const fetchPlatformStats = (options) => request('/api/stats', options);
export const fetchPublicStats = (options) => request('/api/public/stats', options);

/* ── Authentication ──────────────────────────────────────────────── */

const oauthBase = `${API_BASE}/api/auth`;

export const fetchProviders = (options) => request('/api/auth/providers', options);

export async function fetchMe(options) {
  const data = await request('/api/auth/me', options);
  return data?.user || null;
}

export async function registerAccount({ email, password, name }, options) {
  const data = await request('/api/auth/register', {
    method: 'POST',
    body: { email, password, ...(name ? { name } : {}) },
    ...options,
  });
  // Unverified registrations get no session, so do not flip the local UI state.
  if (!data.requiresVerification) emitSessionChange(data.user);
  return data;
}

export async function loginAccount({ email, password }, options) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    ...options,
  });
  emitSessionChange(data.user);
  return data;
}

export async function logoutAccount(options) {
  await request('/api/auth/logout', { method: 'POST', ...options });
  emitSessionChange(null);
}

export const requestPasswordReset = (email, options) =>
  request('/api/auth/forgot-password', { method: 'POST', body: { email }, ...options });

export async function resetPassword({ token, password }, options) {
  const data = await request('/api/auth/reset-password', {
    method: 'POST',
    body: { token, password },
    ...options,
  });
  emitSessionChange(null);
  return data;
}

export async function verifyEmailToken(token, options) {
  const data = await request('/api/auth/verify-email', {
    method: 'POST',
    body: { token },
    ...options,
  });
  return data?.user || null;
}

export const resendVerification = (options) =>
  request('/api/auth/resend-verification', { method: 'POST', ...options });

export function oauthSignInUrl(provider) {
  return `${oauthBase}/oauth/${encodeURIComponent(provider)}`;
}

export function devSignInUrl(email = 'dev@shortly.local') {
  return `${oauthBase}/dev-login?email=${encodeURIComponent(email)}`;
}
