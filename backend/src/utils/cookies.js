import { createHmac, timingSafeEqual } from 'node:crypto';
import config from '../config.js';

/**
 * Minimal cookie helpers. We only need a session cookie and a short-lived
 * OAuth state cookie, so a dependency would add more surface than it saves.
 */

export function parseCookies(header) {
  const result = {};
  if (!header) return result;

  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    const value = part.slice(index + 1).trim();
    try {
      result[name] = decodeURIComponent(value);
    } catch {
      result[name] = value;
    }
  }
  return result;
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  parts.push('HttpOnly');
  if (options.secure ?? config.isProduction) parts.push('Secure');
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  return parts.join('; ');
}

export function clearCookie(name, options = {}) {
  return serializeCookie(name, '', {
    path: options.path || '/',
    sameSite: options.sameSite || 'Lax',
    secure: options.secure,
    maxAge: 0,
  });
}

function sign(value) {
  return createHmac('sha256', config.auth.sessionSecret).update(value).digest('base64url');
}

/** Signed JSON payload, used for the OAuth state cookie. */
export function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyPayload(value) {
  if (typeof value !== 'string' || !value.includes('.')) return null;
  const [body, signature] = value.split('.');
  const expected = sign(body);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;

  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
