import config from '../config.js';
import { AppError, ValidationError } from '../utils/errors.js';

/**
 * Authorization-code flow for Google and GitHub. Tokens are exchanged
 * server-side; the browser only ever sees the provider redirect and our
 * own session cookie.
 */

const GOOGLE = {
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  profileUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
  scope: 'openid email profile',
};

const GITHUB = {
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  profileUrl: 'https://api.github.com/user',
  emailsUrl: 'https://api.github.com/user/emails',
  scope: 'read:user user:email',
};

export const OAUTH_PROVIDERS = ['google', 'github'];

export function isProviderEnabled(provider) {
  const settings = config.auth.providers[provider];
  return Boolean(settings?.clientId && settings?.clientSecret);
}

export function enabledProviders() {
  return OAUTH_PROVIDERS.filter(isProviderEnabled);
}

export function redirectUri(provider) {
  return `${config.auth.callbackBase}/api/auth/oauth/${provider}/callback`;
}

export function buildAuthorizationUrl(provider, state) {
  if (!isProviderEnabled(provider)) throw new ValidationError('This sign-in provider is not configured');

  if (provider === 'google') {
    const params = new URLSearchParams({
      client_id: config.auth.providers.google.clientId,
      redirect_uri: redirectUri('google'),
      response_type: 'code',
      scope: GOOGLE.scope,
      state,
      access_type: 'online',
      prompt: 'select_account',
    });
    return `${GOOGLE.authorizeUrl}?${params}`;
  }

  if (provider === 'github') {
    const params = new URLSearchParams({
      client_id: config.auth.providers.github.clientId,
      redirect_uri: redirectUri('github'),
      scope: GITHUB.scope,
      state,
      allow_signup: 'true',
    });
    return `${GITHUB.authorizeUrl}?${params}`;
  }

  throw new ValidationError('Unsupported sign-in provider');
}

async function fetchJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    throw new AppError(`OAuth provider returned ${response.status}`, 502);
  }
  return response.json();
}

async function exchangeGoogle(code) {
  const body = new URLSearchParams({
    code,
    client_id: config.auth.providers.google.clientId,
    client_secret: config.auth.providers.google.clientSecret,
    redirect_uri: redirectUri('google'),
    grant_type: 'authorization_code',
  });

  const token = await fetchJson(GOOGLE.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const profile = await fetchJson(GOOGLE.profileUrl, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  return {
    provider: 'google',
    providerUserId: String(profile.sub),
    email: profile.email,
    emailVerified: profile.email_verified === true,
    name: profile.name || null,
    avatarUrl: profile.picture || null,
  };
}

async function exchangeGitHub(code) {
  const body = new URLSearchParams({
    code,
    client_id: config.auth.providers.github.clientId,
    client_secret: config.auth.providers.github.clientSecret,
    redirect_uri: redirectUri('github'),
  });

  const token = await fetchJson(GITHUB.tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (token.error) throw new AppError('GitHub rejected the sign-in attempt', 502);

  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'shortly-platform',
  };

  const profile = await fetchJson(GITHUB.profileUrl, { headers });
  // Always confirm ownership through the emails endpoint; profile.email alone
  // is not sufficient evidence that the address is verified.
  const emails = await fetchJson(GITHUB.emailsUrl, { headers });
  const verified = (emails || []).filter((item) => item.verified);
  const primary = verified.find((item) => item.primary)
    || verified.find((item) => item.email === profile.email)
    || verified[0];

  return {
    provider: 'github',
    providerUserId: String(profile.id),
    email: primary?.email || null,
    emailVerified: Boolean(primary),
    name: profile.name || profile.login || null,
    avatarUrl: profile.avatar_url || null,
  };
}

export async function exchangeCode(provider, code) {
  if (provider === 'google') return exchangeGoogle(code);
  if (provider === 'github') return exchangeGitHub(code);
  throw new ValidationError('Unsupported sign-in provider');
}
