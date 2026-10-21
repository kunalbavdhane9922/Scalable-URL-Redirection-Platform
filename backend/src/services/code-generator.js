import { customAlphabet } from 'nanoid';
import config from '../config.js';

/**
 * Short code generator.
 *
 * Per document §6:
 *  - "The short code must be compact, URL-safe, and unique."
 *  - "Generate a random or otherwise collision-resistant candidate."
 *
 * Per document §6.1:
 *  - "Use a URL-safe alphabet, such as letters and digits."
 *  - "Avoid sequential codes if they expose link volume or make enumeration easy;
 *     random codes reduce predictability."
 *  - "Do not assume that checking Redis before insertion guarantees uniqueness;
 *     the database unique constraint must decide the winner."
 *
 * Alphabet: A-Z, a-z, 0-9 (62 characters)
 * Default length: 7 characters → 62^7 ≈ 3.5 trillion combinations
 * For ~100K users creating a few links each, collision probability is negligible.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const generateCode = customAlphabet(ALPHABET, config.shortCode.length);

/**
 * Generate a random short code.
 * @returns {string} A URL-safe random code
 */
export function createShortCode() {
  return generateCode();
}

/**
 * Maximum number of retries when a collision occurs.
 * Per §6.1: "Return a clear conflict/retry outcome internally and retry
 * safely when a candidate collides."
 */
export const MAX_RETRIES = config.shortCode.maxRetries;
