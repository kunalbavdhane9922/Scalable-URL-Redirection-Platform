import { createHash } from 'node:crypto';
import config from '../config.js';
import { authQueries } from '../db/auth-queries.js';
import { hashPassword, verifyPassword, randomToken } from '../utils/passwords.js';
import {
  ValidationError,
  UnauthorizedError,
  ConflictError,
  AppError,
} from '../utils/errors.js';

const SESSION_TTL_MS = config.auth.sessionTtlDays * 24 * 60 * 60 * 1000;
const EMAIL_TOKEN_MINUTES = 60;
const RESET_TOKEN_MINUTES = 30;

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    email: row.email,
    emailVerified: Boolean(row.email_verified),
    name: row.name || null,
    avatarUrl: row.avatar_url || null,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  };
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < config.auth.passwordMinLength) {
    throw new ValidationError(`Password must be at least ${config.auth.passwordMinLength} characters`);
  }
  if (password.length > 200) {
    throw new ValidationError('Password is too long');
  }
}

/**
 * Create a password account. Returns the user row; the caller decides whether
 * to start a session immediately.
 */
export async function registerUser(pgPool, { email, password, name }) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) throw new ValidationError('A valid email is required');
  if (normalized.length > 254) throw new ValidationError('Email is too long');
  validatePassword(password);

  const passwordHash = await hashPassword(password);
  const displayName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : null;

  try {
    const result = await pgPool.query(authQueries.insertUser, [
      normalized,
      displayName,
      passwordHash,
      false,
      null,
    ]);
    return result.rows[0];
  } catch (err) {
    if (err.code === '23505') {
      throw new ConflictError('An account with this email already exists');
    }
    throw err;
  }
}

/** Verify email + password. Always runs a hash comparison even for unknown
 * emails so response timing does not reveal whether an account exists.
 */
let dummyHashPromise = null;
function dummyHash() {
  dummyHashPromise ||= hashPassword(randomToken(16));
  return dummyHashPromise;
}

export async function authenticatePassword(pgPool, email, password) {
  const normalized = normalizeEmail(email);
  const result = await pgPool.query(authQueries.findUserByEmail, [normalized]);
  const row = result.rows[0] || null;

  const stored = row?.password_hash || await dummyHash();
  const ok = await verifyPassword(password || '', stored);

  if (!row || !row.password_hash || !ok) {
    throw new UnauthorizedError('Invalid email or password');
  }
  if (config.auth.requireEmailVerification && !row.email_verified) {
    throw new UnauthorizedError('Verify your email address before signing in');
  }

  await pgPool.query(authQueries.touchLogin, [row.id]).catch(() => {});
  return row;
}

/** Issue an opaque session token; only its hash is persisted. */
export async function createSession(pgPool, userId, { ip, userAgent } = {}) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await pgPool.query(authQueries.insertSession, [
    hashToken(token),
    userId,
    expiresAt,
    ip || null,
    String(userAgent || '').slice(0, 300) || null,
  ]);

  return { token, expiresAt };
}

export async function getSessionUser(pgPool, token) {
  if (!token) return null;
  const result = await pgPool.query(authQueries.findSessionUser, [hashToken(token)]);
  const row = result.rows[0];
  if (!row) return null;
  return { ...publicUser(row), sessionExpiresAt: row.session_expires_at };
}

export async function destroySession(pgPool, token) {
  if (!token) return;
  await pgPool.query(authQueries.deleteSession, [hashToken(token)]);
}

export async function destroyAllSessions(pgPool, userId) {
  await pgPool.query(authQueries.deleteUserSessions, [userId]);
}

/**
 * Link a provider identity to a user. Accounts are matched by provider ID
 * first, then by verified email, and created on first sign-in.
 */
export async function upsertOAuthUser(pgPool, profile) {
  const { provider, providerUserId, email, emailVerified, name, avatarUrl } = profile;
  if (!providerUserId) throw new AppError('OAuth provider returned no account id', 502);

  const linked = await pgPool.query(authQueries.findOAuthAccount, [provider, String(providerUserId)]);
  if (linked.rows[0]) {
    await pgPool.query(authQueries.touchLogin, [linked.rows[0].id]).catch(() => {});
    return linked.rows[0];
  }

  const normalized = normalizeEmail(email);
  if (!normalized) {
    throw new ValidationError('The provider did not supply an email address');
  }
  if (!emailVerified) {
    // Linking by email is only safe when the provider vouches for ownership.
    throw new ValidationError('The provider did not verify this email address');
  }

  const existing = await pgPool.query(authQueries.findUserByEmail, [normalized]);
  let user = existing.rows[0] || null;

  if (!user) {
    const inserted = await pgPool.query(authQueries.insertUser, [
      normalized,
      name ? String(name).slice(0, 80) : null,
      null,
      Boolean(emailVerified),
      avatarUrl || null,
    ]);
    user = inserted.rows[0];
  } else if (emailVerified && !user.email_verified) {
    await pgPool.query(authQueries.markEmailVerified, [user.id]);
    user = { ...user, email_verified: true };
  }

  await pgPool.query(authQueries.insertOAuthAccount, [
    provider,
    String(providerUserId),
    user.id,
  ]);

  await pgPool.query(authQueries.touchLogin, [user.id]).catch(() => {});
  return user;
}

/** Create a single-use token for email verification or password reset. */
export async function issueAuthToken(pgPool, userId, kind) {
  const minutes = kind === 'reset_password' ? RESET_TOKEN_MINUTES : EMAIL_TOKEN_MINUTES;
  const token = randomToken(32);
  await pgPool.query(authQueries.insertAuthToken, [userId, kind, hashToken(token), minutes]);
  return token;
}

/** Atomically consume a token; returns the owning user id or null. */
export async function consumeAuthToken(pgPool, kind, token) {
  if (!token) return null;
  const result = await pgPool.query(authQueries.consumeAuthToken, [hashToken(token), kind]);
  return result.rows[0] ? result.rows[0].user_id : null;
}

export async function verifyEmailToken(pgPool, token) {
  const userId = await consumeAuthToken(pgPool, 'verify_email', token);
  if (!userId) throw new ValidationError('This verification link is invalid or has expired');
  await pgPool.query(authQueries.markEmailVerified, [userId]);
  const result = await pgPool.query(authQueries.findUserById, [userId]);
  return result.rows[0] || null;
}

export async function resetPassword(pgPool, token, password) {
  validatePassword(password);
  const userId = await consumeAuthToken(pgPool, 'reset_password', token);
  if (!userId) throw new ValidationError('This reset link is invalid or has expired');

  const passwordHash = await hashPassword(password);
  await pgPool.query(authQueries.updatePassword, [userId, passwordHash]);
  // A password reset terminates every existing session.
  await destroyAllSessions(pgPool, userId);
  return userId;
}

export async function findUserByEmail(pgPool, email) {
  const result = await pgPool.query(authQueries.findUserByEmail, [normalizeEmail(email)]);
  return result.rows[0] || null;
}

export async function findUserById(pgPool, userId) {
  const result = await pgPool.query(authQueries.findUserById, [userId]);
  return result.rows[0] || null;
}

/** One-time cleanup for expired sessions and tokens. */
export async function purgeExpiredAuth(pgPool) {
  await pgPool.query(authQueries.purgeExpiredSessions).catch(() => {});
  await pgPool.query(authQueries.purgeExpiredAuthTokens).catch(() => {});
}
