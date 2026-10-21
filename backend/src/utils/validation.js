import config from '../config.js';
import { ValidationError } from './errors.js';

/**
 * URL and short-code validation utilities.
 *
 * Per document §13:
 *  - Accept only http/https schemes; reject javascript:, data:, file:, etc.
 *  - Normalize and validate URL syntax.
 *  - Enforce a maximum input length.
 *
 * Per document §6.1:
 *  - Use a URL-safe alphabet.
 *  - Validate code format cheaply before lookup.
 */

// URL-safe alphabet for short codes: [A-Za-z0-9]
const CODE_PATTERN = /^[A-Za-z0-9]+$/;

/**
 * Validate that a short code has the expected format.
 * Per §8 step 3: "Validate the code's format and reject malformed input cheaply."
 */
export function isValidCodeFormat(code) {
  if (!code || typeof code !== 'string') return false;
  if (code.length < 1 || code.length > 20) return false;
  return CODE_PATTERN.test(code);
}

/**
 * Validate a submitted URL for shortening.
 * Throws ValidationError with a user-safe message on failure.
 */
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

  // §13: "Accept only intended URL schemes (normally HTTP and HTTPS);
  //  reject javascript:, data:, file:, and other unsafe schemes."
  const scheme = parsed.protocol.replace(':', '').toLowerCase();
  if (!config.validation.allowedSchemes.includes(scheme)) {
    throw new ValidationError(`URL scheme "${scheme}" is not allowed. Only ${config.validation.allowedSchemes.join(', ')} are accepted`);
  }

  // Ensure hostname is present (prevents things like "http:///path")
  if (!parsed.hostname || parsed.hostname.length === 0) {
    throw new ValidationError('URL must have a valid hostname');
  }

  return parsed.href; // normalized form
}

/**
 * Check whether a mapping is active and not expired.
 * Per §8 step 6: "Check whether the link exists, is active, and has not expired."
 * Per §10 step 6: "check expires_at at the authoritative lookup"
 */
export function isActiveAndUnexpired(mapping) {
  if (!mapping) return false;
  if (mapping.status !== 'active') return false;
  if (mapping.expires_at && new Date(mapping.expires_at) <= new Date()) return false;
  return true;
}
