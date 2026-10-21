import { describe, it, expect } from '@jest/globals';
import { isValidCodeFormat, validateUrl, isActiveAndUnexpired } from '../../src/utils/validation.js';
import { ValidationError } from '../../src/utils/errors.js';

describe('Validation Utilities (§13 Security & Input Safety)', () => {
  describe('isValidCodeFormat', () => {
    it('accepts valid alphanumeric short codes', () => {
      expect(isValidCodeFormat('abc123X')).toBe(true);
      expect(isValidCodeFormat('a')).toBe(true);
      expect(isValidCodeFormat('ABCDEFG1234567890xyz')).toBe(true);
    });

    it('rejects invalid or dangerous characters', () => {
      expect(isValidCodeFormat('abc/def')).toBe(false);
      expect(isValidCodeFormat('abc.def')).toBe(false);
      expect(isValidCodeFormat('abc?def')).toBe(false);
      expect(isValidCodeFormat('abc#def')).toBe(false);
      expect(isValidCodeFormat('abc<script>')).toBe(false);
      expect(isValidCodeFormat('abc; DROP TABLE urls;--')).toBe(false);
      expect(isValidCodeFormat('   ')).toBe(false);
      expect(isValidCodeFormat('')).toBe(false);
    });

    it('rejects non-string or oversized codes', () => {
      expect(isValidCodeFormat(null)).toBe(false);
      expect(isValidCodeFormat(undefined)).toBe(false);
      expect(isValidCodeFormat(12345)).toBe(false);
      expect(isValidCodeFormat('a'.repeat(21))).toBe(false); // max is 20
    });
  });

  describe('validateUrl (§13 Schemes and Syntax)', () => {
    it('accepts valid http and https URLs', () => {
      expect(validateUrl('https://example.com')).toBe('https://example.com/');
      expect(validateUrl('http://example.com/path?query=1#hash')).toBe('http://example.com/path?query=1#hash');
      expect(validateUrl('https://sub.domain.org/nested/resource')).toBe('https://sub.domain.org/nested/resource');
    });

    it('rejects unsafe schemes (javascript:, data:, file:, etc.)', () => {
      expect(() => validateUrl('javascript:alert(1)')).toThrow(ValidationError);
      expect(() => validateUrl('data:text/html;base64,PHNjcmlwdD4=')).toThrow(ValidationError);
      expect(() => validateUrl('file:///etc/passwd')).toThrow(ValidationError);
      expect(() => validateUrl('ftp://example.com')).toThrow(ValidationError);
      expect(() => validateUrl('vbscript:msgbox(1)')).toThrow(ValidationError);
    });

    it('rejects empty, non-string, or malformed URLs', () => {
      expect(() => validateUrl('')).toThrow(ValidationError);
      expect(() => validateUrl('   ')).toThrow(ValidationError);
      expect(() => validateUrl(null)).toThrow(ValidationError);
      expect(() => validateUrl('not a url')).toThrow(ValidationError);
      expect(() => validateUrl('http://')).toThrow(ValidationError);
    });

    it('rejects URLs exceeding max length (2048 chars)', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2048);
      expect(() => validateUrl(longUrl)).toThrow(ValidationError);
    });

    it('normalizes URLs correctly', () => {
      const normalized = validateUrl('  https://EXAMPLE.COM/path/  ');
      expect(normalized).toBe('https://example.com/path/');
    });
  });

  describe('isActiveAndUnexpired (§8 step 6 & §10 step 6)', () => {
    it('returns true for active link without expiration', () => {
      const link = { status: 'active', expires_at: null };
      expect(isActiveAndUnexpired(link)).toBe(true);
    });

    it('returns true for active link with future expiration', () => {
      const futureDate = new Date(Date.now() + 1000 * 3600).toISOString();
      const link = { status: 'active', expires_at: futureDate };
      expect(isActiveAndUnexpired(link)).toBe(true);
    });

    it('returns false for disabled or expired status', () => {
      expect(isActiveAndUnexpired({ status: 'disabled', expires_at: null })).toBe(false);
      expect(isActiveAndUnexpired({ status: 'expired', expires_at: null })).toBe(false);
      expect(isActiveAndUnexpired(null)).toBe(false);
    });

    it('returns false for active link whose expires_at is in the past', () => {
      const pastDate = new Date(Date.now() - 10000).toISOString();
      const link = { status: 'active', expires_at: pastDate };
      expect(isActiveAndUnexpired(link)).toBe(false);
    });
  });
});
