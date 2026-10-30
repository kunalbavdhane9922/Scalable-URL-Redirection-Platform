import { describe, it, expect } from '@jest/globals';
import {
  isValidCodeFormat,
  validateAlias,
  validateUrl,
  isActiveAndUnexpired,
  deviceFromUserAgent,
  referrerHost,
} from '../../src/utils/validation.js';
import { ValidationError } from '../../src/utils/errors.js';

describe('Validation Utilities (§13 Security & Input Safety)', () => {
  describe('isValidCodeFormat', () => {
    it('accepts valid alphanumeric short codes', () => {
      expect(isValidCodeFormat('abc123X')).toBe(true);
      expect(isValidCodeFormat('a')).toBe(true);
      expect(isValidCodeFormat('ABCDEFG1234567890xyz')).toBe(true);
      expect(isValidCodeFormat('a'.repeat(32))).toBe(true); // alias max
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
      expect(isValidCodeFormat('a'.repeat(33))).toBe(false); // max is 32
    });
  });

  describe('validateAlias (custom alias safety)', () => {
    it('accepts normal aliases', () => {
      expect(validateAlias('summer-sale_2026')).toBe('summer-sale_2026');
      expect(validateAlias('  spaced  ')).toBe('spaced');
    });

    it('rejects aliases that are too short or too long', () => {
      expect(() => validateAlias('ab')).toThrow(ValidationError);
      expect(() => validateAlias('a'.repeat(33))).toThrow(ValidationError);
    });

    it('rejects reserved aliases so routes cannot be shadowed', () => {
      expect(() => validateAlias('api')).toThrow(ValidationError);
      expect(() => validateAlias('HEALTH')).toThrow(ValidationError);
      expect(() => validateAlias('metrics')).toThrow(ValidationError);
      expect(() => validateAlias('dashboard')).toThrow(ValidationError);
      expect(() => validateAlias('register')).toThrow(ValidationError);
      expect(() => validateAlias('forgot-password')).toThrow(ValidationError);
      expect(() => validateAlias('reset-password')).toThrow(ValidationError);
      expect(() => validateAlias('verify-email')).toThrow(ValidationError);
    });

    it('rejects unsafe characters and non-strings', () => {
      expect(() => validateAlias('bad alias')).toThrow(ValidationError);
      expect(() => validateAlias('bad/alias')).toThrow(ValidationError);
      expect(() => validateAlias('../../etc')).toThrow(ValidationError);
      expect(() => validateAlias(42)).toThrow(ValidationError);
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

  describe('Analytics helpers', () => {
    it('derives coarse device labels from user agents', () => {
      expect(deviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile')).toBe('mobile');
      expect(deviceFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0) Tablet')).toBe('tablet');
      expect(deviceFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('desktop');
      expect(deviceFromUserAgent('Googlebot/2.1')).toBe('bot');
      expect(deviceFromUserAgent('')).toBe('unknown');
    });

    it('extracts referrer host without storing the full URL', () => {
      expect(referrerHost('https://news.ycombinator.com/item?id=1')).toBe('news.ycombinator.com');
      expect(referrerHost('')).toBe('direct');
      expect(referrerHost('not a url')).toBe('direct');
    });
  });
});
