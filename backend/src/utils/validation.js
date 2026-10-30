import config from '../config.js';
import { ValidationError } from './errors.js';

/**
 * URL, short-code, and alias validation.
 *
 * Only http/https are accepted, length is bounded, and aliases are restricted
 * to URL-safe characters with reserved words blocked so aliases can never
 * shadow API or app routes.
 */

const CODE_PATTERN = /^[A-Za-z0-9_-]+$/;
const ALIAS_PATTERN = /^[A-Za-z0-9_-]+$/;

export const RESERVED_ALIASES = new Set([
  'api', 'health', 'metrics', 'dashboard', 'admin', 'login', 'signup',
  'register', 'forgot-password', 'reset-password', 'verify-email',
  'assets', 'static', 'favicon.ico', 'robots.txt', 'sitemap.xml',
  'manifest.json', 'well-known', '_next', 'docs', 'openapi', 'redoc',
]);

export function isValidCodeFormat(code) {
  if (!code || typeof code !== 'string') return false;
  if (code.length < 1 || code.length > 32) return false;
  return CODE_PATTERN.test(code);
}

/**
 * Validate a user-chosen alias and return it unchanged.
 */
export function validateAlias(alias) {
  if (typeof alias !== 'string') {
    throw new ValidationError('Custom alias must be a string');
  }
  const trimmed = alias.trim();
  const { aliasMinLength, aliasMaxLength } = config.shortCode;

  if (trimmed.length < aliasMinLength || trimmed.length > aliasMaxLength) {
    throw new ValidationError(
      `Custom alias must be between ${aliasMinLength} and ${aliasMaxLength} characters`,
    );
  }
  if (!ALIAS_PATTERN.test(trimmed)) {
    throw new ValidationError('Custom alias may only contain letters, numbers, hyphens, and underscores');
  }
  if (RESERVED_ALIASES.has(trimmed.toLowerCase())) {
    throw new ValidationError('That alias is reserved, please choose another');
  }
  return trimmed;
}

export function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new ValidationError('URL is required');
  }

  const trimmed = url.trim();

  if (trimmed.length === 0) {
    throw new ValidationError('URL is required');
  }

  if (trimmed.length > config.validation.maxUrlLength) {
    throw new ValidationError(`URL exceeds maximum length of ${config.validation.maxUrlLength} characters`);
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ValidationError('Invalid URL format');
  }

  const scheme = parsed.protocol.replace(':', '').toLowerCase();
  if (!config.validation.allowedSchemes.includes(scheme)) {
    throw new ValidationError(
      `URL scheme "${scheme}" is not allowed. Only ${config.validation.allowedSchemes.join(', ')} are accepted`,
    );
  }

  if (!parsed.hostname || parsed.hostname.length === 0) {
    throw new ValidationError('URL must have a valid hostname');
  }

  return parsed.href;
}

export function isActiveAndUnexpired(mapping) {
  if (!mapping) return false;
  if (mapping.status !== 'active') return false;
  if (mapping.expires_at && new Date(mapping.expires_at) <= new Date()) return false;
  return true;
}

/**
 * Derive a coarse device label from a user-agent string for analytics.
 */
export function deviceFromUserAgent(userAgent) {
  const ua = (userAgent || '').toLowerCase();
  if (!ua) return 'unknown';
  if (/bot|crawler|spider|curl|wget|python|node-fetch|axios/.test(ua)) return 'bot';
  if (/ipad|tablet/.test(ua)) return 'tablet';
  if (/mobile|android|iphone|ipod/.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * Extract a referrer host without storing full referrer URLs (privacy).
 */
export function referrerHost(referrer) {
  if (!referrer) return 'direct';
  try {
    return new URL(referrer).hostname || 'direct';
  } catch {
    return 'direct';
  }
}
