/**
 * Parameterized SQL for accounts, sessions, OAuth links, and email tokens.
 */

export const authQueries = {
  insertUser: `
    INSERT INTO users (email, name, password_hash, email_verified, avatar_url)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, email, email_verified, name, avatar_url, created_at
  `,

  findUserByEmail: `
    SELECT id, email, email_verified, name, avatar_url, password_hash, created_at
    FROM users
    WHERE email = $1
  `,

  findUserById: `
    SELECT id, email, email_verified, name, avatar_url, created_at, last_login_at
    FROM users
    WHERE id = $1
  `,

  touchLogin: `
    UPDATE users SET last_login_at = NOW() WHERE id = $1
  `,

  markEmailVerified: `
    UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE id = $1
  `,

  updatePassword: `
    UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1
  `,

  updateProfile: `
    UPDATE users SET name = COALESCE($2, name), avatar_url = COALESCE($3, avatar_url), updated_at = NOW()
    WHERE id = $1
    RETURNING id, email, email_verified, name, avatar_url
  `,

  insertSession: `
    INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent)
    VALUES ($1, $2, $3, $4, $5)
  `,

  findSessionUser: `
    SELECT u.id, u.email, u.email_verified, u.name, u.avatar_url, u.created_at,
           s.expires_at AS session_expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > NOW()
  `,

  deleteSession: `
    DELETE FROM sessions WHERE token_hash = $1
  `,

  deleteUserSessions: `
    DELETE FROM sessions WHERE user_id = $1
  `,

  purgeExpiredSessions: `
    DELETE FROM sessions WHERE expires_at <= NOW()
  `,

  findOAuthAccount: `
    SELECT u.id, u.email, u.email_verified, u.name, u.avatar_url, u.created_at
    FROM oauth_accounts oa
    JOIN users u ON u.id = oa.user_id
    WHERE oa.provider = $1 AND oa.provider_user_id = $2
  `,

  insertOAuthAccount: `
    INSERT INTO oauth_accounts (provider, provider_user_id, user_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (provider, provider_user_id) DO NOTHING
  `,

  insertAuthToken: `
    INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at)
    VALUES ($1, $2, $3, NOW() + make_interval(mins => $4))
  `,

  consumeAuthToken: `
    UPDATE auth_tokens
    SET used_at = NOW()
    WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > NOW()
    RETURNING user_id
  `,

  purgeExpiredAuthTokens: `
    DELETE FROM auth_tokens WHERE expires_at <= NOW() OR used_at IS NOT NULL
  `,
};
