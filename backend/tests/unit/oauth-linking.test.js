import { describe, it, expect } from '@jest/globals';
import { upsertOAuthUser } from '../../src/services/auth-service.js';
import { ValidationError } from '../../src/utils/errors.js';

function createPool(handlers) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    for (const [needle, handler] of Object.entries(handlers)) {
      if (sql.includes(needle)) return handler(params);
    }
    return { rows: [] };
  };
  return { calls, query };
}

const profile = {
  provider: 'google',
  providerUserId: 'g-123',
  email: 'person@example.com',
  emailVerified: true,
  name: 'Person',
  avatarUrl: null,
};

describe('OAuth account linking', () => {
  it('refuses to link an email the provider did not verify', async () => {
    const pool = createPool({
      'FROM oauth_accounts': () => ({ rows: [] }),
    });

    await expect(upsertOAuthUser(pool, { ...profile, emailVerified: false }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(pool.calls.some((call) => call.sql.includes('INSERT INTO oauth_accounts'))).toBe(false);
  });

  it('links a verified identity to an existing account', async () => {
    const existing = {
      id: 7,
      email: 'person@example.com',
      email_verified: true,
      name: 'Person',
      avatar_url: null,
    };
    const pool = createPool({
      'FROM oauth_accounts': () => ({ rows: [] }),
      'FROM users': () => ({ rows: [existing] }),
      'INSERT INTO oauth_accounts': () => ({ rows: [] }),
    });

    const user = await upsertOAuthUser(pool, profile);
    expect(user.id).toBe(7);
    const insert = pool.calls.find((call) => call.sql.includes('INSERT INTO oauth_accounts'));
    expect(insert.params).toEqual(['google', 'g-123', 7]);
  });

  it('marks an existing account verified when the provider vouches for the email', async () => {
    const existing = {
      id: 9,
      email: 'person@example.com',
      email_verified: false,
      name: 'Person',
      avatar_url: null,
    };
    const pool = createPool({
      'FROM oauth_accounts': () => ({ rows: [] }),
      'FROM users': () => ({ rows: [existing] }),
      'INSERT INTO oauth_accounts': () => ({ rows: [] }),
    });

    const user = await upsertOAuthUser(pool, profile);
    expect(user.email_verified).toBe(true);
    expect(pool.calls.some((call) => call.sql.includes('email_verified = TRUE'))).toBe(true);
  });

  it('creates a user for a new verified identity', async () => {
    const created = {
      id: 11,
      email: 'person@example.com',
      email_verified: true,
      name: 'Person',
      avatar_url: null,
    };
    const pool = createPool({
      'FROM oauth_accounts': () => ({ rows: [] }),
      'FROM users': () => ({ rows: [] }),
      'INSERT INTO users': () => ({ rows: [created] }),
      'INSERT INTO oauth_accounts': () => ({ rows: [] }),
    });

    const user = await upsertOAuthUser(pool, profile);
    expect(user.id).toBe(11);
    expect(pool.calls.some((call) => call.sql.includes('INSERT INTO users'))).toBe(true);
  });
});
