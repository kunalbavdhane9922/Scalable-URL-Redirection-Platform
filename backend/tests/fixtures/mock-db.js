/**
 * In-memory PostgreSQL Pool and Redis mock for integration tests.
 */

export function createMockPgPool() {
  const urls = new Map();
  const outbox = [];
  const clickAnalytics = new Map(); // `${short_code}:${date}` -> count
  const clickBreakdown = new Map(); // `${code}|${date}|${dimension}|${value}` -> count
  const users = new Map(); // email -> user
  const sessions = new Map(); // token_hash -> session
  const oauthAccounts = []; // { provider, provider_user_id, user_id }
  const authTokens = new Map(); // token_hash -> { user_id, kind, expires_at, used_at }
  let idCounter = 1;
  let userIdCounter = 1;

  const toRow = (record) => ({
    ...record,
    click_count: record.click_count || 0,
    last_clicked_at: record.last_clicked_at || null,
  });

  const executeQuery = async (sql, params = []) => {
    const trimmed = sql.trim();

    if (trimmed === 'SELECT 1') return { rows: [{ '?column?': 1 }], rowCount: 1 };
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(trimmed)) return { rows: [], rowCount: 0 };

    if (trimmed.includes('INSERT INTO urls')) {
      const [code, originalUrl, status, expiresAt, userId] = params;
      if (urls.has(code)) {
        const err = new Error('duplicate key value violates unique constraint "idx_urls_short_code"');
        err.code = '23505';
        throw err;
      }
      const record = {
        id: idCounter++,
        short_code: code,
        original_url: originalUrl,
        status: status || 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        expires_at: expiresAt || null,
        user_id: userId || null,
        click_count: 0,
        last_clicked_at: null,
      };
      urls.set(code, record);
      return { rows: [record], rowCount: 1 };
    }

    // ─── Accounts ──────────────────────────────────────────────────
    if (trimmed.includes('INSERT INTO users')) {
      const [email, name, passwordHash, emailVerified, avatarUrl] = params;
      if (users.has(email)) {
        const err = new Error('duplicate key value violates unique constraint "idx_users_email"');
        err.code = '23505';
        throw err;
      }
      const record = {
        id: userIdCounter++,
        email,
        name: name || null,
        password_hash: passwordHash,
        email_verified: Boolean(emailVerified),
        avatar_url: avatarUrl || null,
        created_at: new Date().toISOString(),
        last_login_at: null,
      };
      users.set(email, record);
      return { rows: [{ ...record }], rowCount: 1 };
    }

    if (trimmed.includes('FROM users') && trimmed.includes('WHERE email = $1')) {
      const record = users.get(params[0]);
      return { rows: record ? [{ ...record }] : [], rowCount: record ? 1 : 0 };
    }

    if (trimmed.includes('FROM users') && trimmed.includes('WHERE id = $1')) {
      const record = [...users.values()].find(u => u.id === Number(params[0]));
      return { rows: record ? [{ ...record }] : [], rowCount: record ? 1 : 0 };
    }

    if (trimmed.includes('UPDATE users') && trimmed.includes('last_login_at')) {
      const record = [...users.values()].find(u => u.id === Number(params[0]));
      if (record) record.last_login_at = new Date().toISOString();
      return { rows: [], rowCount: record ? 1 : 0 };
    }

    if (trimmed.includes('UPDATE users') && trimmed.includes('email_verified = TRUE')) {
      const record = [...users.values()].find(u => u.id === Number(params[0]));
      if (record) record.email_verified = true;
      return { rows: [], rowCount: record ? 1 : 0 };
    }

    if (trimmed.includes('UPDATE users') && trimmed.includes('password_hash = $2')) {
      const record = [...users.values()].find(u => u.id === Number(params[0]));
      if (record) record.password_hash = params[1];
      return { rows: [], rowCount: record ? 1 : 0 };
    }

    if (trimmed.includes('UPDATE users') && trimmed.includes('name = COALESCE')) {
      const record = [...users.values()].find(u => u.id === Number(params[0]));
      if (record) {
        record.name = params[1] ?? record.name;
        record.avatar_url = params[2] ?? record.avatar_url;
        return { rows: [record], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (trimmed.includes('INSERT INTO sessions')) {
      const [tokenHash, userId, expiresAt, ip, userAgent] = params;
      sessions.set(tokenHash, {
        token_hash: tokenHash,
        user_id: Number(userId),
        expires_at: new Date(expiresAt),
        ip: ip || null,
        user_agent: userAgent || null,
      });
      return { rows: [], rowCount: 1 };
    }

    if (trimmed.includes('FROM sessions s') && trimmed.includes('s.token_hash = $1')) {
      const session = sessions.get(params[0]);
      if (!session || session.expires_at <= new Date()) return { rows: [], rowCount: 0 };
      const user = [...users.values()].find(u => u.id === session.user_id);
      if (!user) return { rows: [], rowCount: 0 };
      return {
        rows: [{ ...user, session_expires_at: session.expires_at }],
        rowCount: 1,
      };
    }

    if (trimmed.includes('DELETE FROM sessions') && trimmed.includes('token_hash = $1')) {
      return { rows: [], rowCount: sessions.delete(params[0]) ? 1 : 0 };
    }

    if (trimmed.includes('DELETE FROM sessions') && trimmed.includes('user_id = $1')) {
      let removed = 0;
      for (const [key, session] of sessions.entries()) {
        if (session.user_id === Number(params[0])) {
          sessions.delete(key);
          removed += 1;
        }
      }
      return { rows: [], rowCount: removed };
    }

    if (trimmed.includes('DELETE FROM sessions') && trimmed.includes('expires_at')) {
      let removed = 0;
      for (const [key, session] of sessions.entries()) {
        if (session.expires_at <= new Date()) {
          sessions.delete(key);
          removed += 1;
        }
      }
      return { rows: [], rowCount: removed };
    }

    if (trimmed.includes('FROM oauth_accounts oa')) {
      const [provider, providerUserId] = params;
      const link = oauthAccounts.find(
        a => a.provider === provider && a.provider_user_id === String(providerUserId),
      );
      const user = link ? [...users.values()].find(u => u.id === link.user_id) : null;
      return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
    }

    if (trimmed.includes('INSERT INTO oauth_accounts')) {
      const [provider, providerUserId, userId] = params;
      const exists = oauthAccounts.some(
        a => a.provider === provider && a.provider_user_id === String(providerUserId),
      );
      if (!exists) {
        oauthAccounts.push({
          provider,
          provider_user_id: String(providerUserId),
          user_id: Number(userId),
        });
      }
      return { rows: [], rowCount: exists ? 0 : 1 };
    }

    if (trimmed.includes('INSERT INTO auth_tokens')) {
      const [userId, kind, tokenHash, minutes] = params;
      authTokens.set(tokenHash, {
        user_id: Number(userId),
        kind,
        expires_at: new Date(Date.now() + Number(minutes) * 60000),
        used_at: null,
      });
      return { rows: [], rowCount: 1 };
    }

    if (trimmed.includes('UPDATE auth_tokens') && trimmed.includes('used_at = NOW()')) {
      const token = authTokens.get(params[0]);
      if (!token || token.kind !== params[1] || token.used_at || token.expires_at <= new Date()) {
        return { rows: [], rowCount: 0 };
      }
      token.used_at = new Date();
      return { rows: [{ user_id: token.user_id }], rowCount: 1 };
    }

    if (trimmed.includes('DELETE FROM auth_tokens')) {
      let removed = 0;
      for (const [key, token] of authTokens.entries()) {
        if (token.expires_at <= new Date() || token.used_at) {
          authTokens.delete(key);
          removed += 1;
        }
      }
      return { rows: [], rowCount: removed };
    }

    if (trimmed.includes('INSERT INTO outbox')) {
      const [eventType, payload] = params;
      const record = {
        id: outbox.length + 1,
        event_type: eventType,
        payload: typeof payload === 'string' ? JSON.parse(payload) : payload,
        created_at: new Date().toISOString(),
        published_at: null,
        claimed_at: null,
        retries: 0,
      };
      outbox.push(record);
      return { rows: [{ id: record.id }], rowCount: 1 };
    }

    if (trimmed.includes('UPDATE outbox o') && trimmed.includes('SKIP LOCKED')) {
      const limit = params[0] || 50;
      const claimed = outbox.filter(o => !o.published_at && !o.claimed_at).slice(0, limit);
      for (const o of claimed) o.claimed_at = new Date().toISOString();
      return { rows: claimed.map(o => ({ ...o })), rowCount: claimed.length };
    }

    if (trimmed.includes('SET published_at = NOW(), claimed_at = NULL')) {
      const record = outbox.find(o => o.id === params[0]);
      if (record) record.published_at = new Date().toISOString();
      return { rows: [], rowCount: record ? 1 : 0 };
    }

    if (trimmed.includes('SET claimed_at = NULL, retries = retries + 1')) {
      const record = outbox.find(o => o.id === params[0]);
      if (record) {
        record.claimed_at = null;
        record.retries += 1;
      }
      return { rows: [], rowCount: record ? 1 : 0 };
    }

    if (trimmed.includes('SELECT u.id') && trimmed.includes('COUNT(*) OVER()')) {
      const limit = params[params.length - 2] ?? 20;
      const offset = params[params.length - 1] ?? 0;
      const search = params.find(p => typeof p === 'string' && p.startsWith('%') && p.endsWith('%'));
      const status = params.find(p => ['active', 'disabled', 'expired'].includes(p));

      let list = Array.from(urls.values());
      if (trimmed.includes('u.user_id = $1')) {
        list = list.filter(u => u.user_id === Number(params[0]));
      }
      if (status) list = list.filter(u => u.status === status);
      if (search) {
        const q = search.slice(1, -1).toLowerCase();
        list = list.filter(u =>
          u.short_code.toLowerCase().includes(q) || u.original_url.toLowerCase().includes(q));
      }
      list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const total = list.length;
      const page = list.slice(offset, offset + limit).map(u => ({ ...toRow(u), total_count: total }));
      return { rows: page, rowCount: page.length };
    }

    if (trimmed.includes('FROM urls u') && trimmed.includes('ORDER BY u.created_at DESC')) {
      const limit = params[0] || 50;
      const list = Array.from(urls.values())
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit)
        .map(toRow);
      return { rows: list, rowCount: list.length };
    }

    if (trimmed.includes('COUNT(*)::BIGINT AS total_links')) {
      const scoped = trimmed.includes('user_id = $1') && params[0] != null
        ? Number(params[0])
        : null;
      const list = Array.from(urls.values())
        .filter(u => scoped === null || u.user_id === scoped);
      const row = {
        total_links: list.length,
        active_links: list.filter(u => u.status === 'active').length,
        disabled_links: list.filter(u => u.status === 'disabled').length,
        expired_links: list.filter(u => u.status === 'expired').length,
        total_clicks: list.reduce((sum, u) => sum + (u.click_count || 0), 0),
        links_last_24h: list.length,
      };
      return { rows: [row], rowCount: 1 };
    }

    if (trimmed.includes('ORDER BY click_count DESC')) {
      const scoped = trimmed.includes('user_id = $1') && params[0] != null
        ? Number(params[0])
        : null;
      const list = Array.from(urls.values())
        .filter(u => scoped === null || u.user_id === scoped)
        .sort((a, b) => (b.click_count || 0) - (a.click_count || 0))
        .slice(0, 5)
        .map(u => ({ short_code: u.short_code, original_url: u.original_url, click_count: u.click_count || 0 }));
      return { rows: list, rowCount: list.length };
    }

    if (trimmed.includes('WHERE short_code = $1') && !trimmed.includes('UPDATE')) {
      const [code] = params;
      const record = urls.get(code);
      return { rows: record ? [toRow(record)] : [], rowCount: record ? 1 : 0 };
    }

    if (trimmed.includes('UPDATE urls') && trimmed.includes('original_url = $2') && trimmed.includes('expires_at = $3')) {
      const [code, newUrl, newExpiry, scope] = params;
      const record = urls.get(code);
      if (!record || record.status !== 'active') return { rows: [], rowCount: 0 };
      if (scope != null && String(record.user_id) !== String(scope)) return { rows: [], rowCount: 0 };
      record.original_url = newUrl;
      record.expires_at = newExpiry || null;
      record.updated_at = new Date().toISOString();
      return { rows: [{ ...record }], rowCount: 1 };
    }

    if (trimmed.includes('UPDATE urls') && trimmed.includes('original_url = $2')) {
      const [code, newUrl, scope] = params;
      const record = urls.get(code);
      if (!record || record.status !== 'active') return { rows: [], rowCount: 0 };
      if (scope != null && String(record.user_id) !== String(scope)) return { rows: [], rowCount: 0 };
      record.original_url = newUrl;
      record.updated_at = new Date().toISOString();
      return { rows: [{ ...record }], rowCount: 1 };
    }

    if (trimmed.includes('UPDATE urls') && trimmed.includes('expires_at = $2')) {
      const [code, newExpiry, scope] = params;
      const record = urls.get(code);
      if (!record || record.status !== 'active') return { rows: [], rowCount: 0 };
      if (scope != null && String(record.user_id) !== String(scope)) return { rows: [], rowCount: 0 };
      record.expires_at = newExpiry || null;
      record.updated_at = new Date().toISOString();
      return { rows: [{ ...record }], rowCount: 1 };
    }

    if (trimmed.includes('UPDATE urls') && trimmed.includes('status = $2')) {
      const [code, newStatus, scope] = params;
      const record = urls.get(code);
      if (!record || record.status !== 'active') return { rows: [], rowCount: 0 };
      if (scope != null && String(record.user_id) !== String(scope)) return { rows: [], rowCount: 0 };
      record.status = newStatus;
      record.updated_at = new Date().toISOString();
      return { rows: [{ ...record }], rowCount: 1 };
    }

    if (trimmed.includes('UPDATE urls') && trimmed.includes("SET status = 'expired'")) {
      const ids = params[0] || [];
      const updated = [];
      for (const record of urls.values()) {
        if (ids.includes(record.id)) {
          record.status = 'expired';
          record.updated_at = new Date().toISOString();
          updated.push({ short_code: record.short_code });
        }
      }
      return { rows: updated, rowCount: updated.length };
    }

    if (trimmed.includes('UPDATE urls u') && trimmed.includes('click_count = u.click_count + v.cnt')) {
      const codes = params[0] || [];
      const counts = params[1] || [];
      let updated = 0;
      codes.forEach((code, i) => {
        const record = urls.get(code);
        if (record) {
          record.click_count = (record.click_count || 0) + (counts[i] || 0);
          record.last_clicked_at = new Date().toISOString();
          updated += 1;
        }
      });
      return { rows: [], rowCount: updated };
    }

    if (trimmed.includes('INSERT INTO click_analytics')) {
      const [codes, dates, counts] = params;
      (codes || []).forEach((code, i) => {
        const key = `${code}:${dates[i]}`;
        clickAnalytics.set(key, (clickAnalytics.get(key) || 0) + (counts[i] || 0));
      });
      return { rows: [], rowCount: codes?.length || 0 };
    }

    if (trimmed.includes('INSERT INTO click_breakdown')) {
      const [codes, dates, dims, values, counts] = params;
      (codes || []).forEach((code, i) => {
        const key = `${code}|${dates[i]}|${dims[i]}|${values[i]}`;
        clickBreakdown.set(key, (clickBreakdown.get(key) || 0) + (counts[i] || 0));
      });
      return { rows: [], rowCount: codes?.length || 0 };
    }

    if (trimmed.includes('FROM click_analytics') && trimmed.includes('WHERE short_code = $1')) {
      const [code] = params;
      const rows = [];
      for (const [key, count] of clickAnalytics.entries()) {
        const [shortCode, date] = key.split(':');
        if (shortCode === code) rows.push({ click_date: date, click_count: count });
      }
      return { rows, rowCount: rows.length };
    }

    if (trimmed.includes('FROM click_analytics')) {
      const scoped = trimmed.includes('u.user_id = $1') && params[0] != null
        ? Number(params[0])
        : null;
      const byDate = new Map();
      for (const [key, count] of clickAnalytics.entries()) {
        const [shortCode, date] = key.split(':');
        if (scoped !== null && urls.get(shortCode)?.user_id !== scoped) continue;
        byDate.set(date, (byDate.get(date) || 0) + count);
      }
      const rows = [...byDate.entries()]
        .map(([click_date, clicks]) => ({ click_date, clicks }))
        .sort((a, b) => String(a.click_date).localeCompare(String(b.click_date)));
      return { rows, rowCount: rows.length };
    }

    if (trimmed.includes('FROM click_breakdown')) {
      const [code] = params;
      const rows = [];
      for (const [key, count] of clickBreakdown.entries()) {
        const [shortCode, , dimension, value] = key.split('|');
        if (shortCode === code) rows.push({ dimension, value, count });
      }
      return { rows, rowCount: rows.length };
    }

    if (trimmed.includes("WHERE status = 'active'") && trimmed.includes('expires_at <= NOW()')) {
      const now = new Date();
      const expired = Array.from(urls.values()).filter(
        u => u.status === 'active' && u.expires_at && new Date(u.expires_at) <= now,
      );
      return { rows: expired, rowCount: expired.length };
    }

    return { rows: [], rowCount: 0 };
  };

  const pool = {
    totalCount: 5,
    idleCount: 5,
    waitingCount: 0,
    query: executeQuery,
    connect: async () => ({ query: executeQuery, release: () => {} }),
    end: async () => {},
    _urls: urls,
    _outbox: outbox,
    _clickAnalytics: clickAnalytics,
    _users: users,
    _sessions: sessions,
  };

  return pool;
}

export function createMockRedis() {
  const store = new Map();
  const published = [];
  const streamEvents = [];

  const setex = (key, ttl, val) => {
    store.set(key, val);
    return Promise.resolve('OK');
  };

  const del = (...keys) => {
    let count = 0;
    for (const k of keys) {
      if (store.delete(k)) count += 1;
    }
    return Promise.resolve(count);
  };

  const xadd = async (stream, id, ...fieldValues) => {
    const event = { stream, id };
    for (let i = 0; i < fieldValues.length; i += 2) {
      event[fieldValues[i]] = fieldValues[i + 1];
    }
    streamEvents.push(event);
    return '1700000000000-0';
  };

  return {
    status: 'ready',
    get: async (key) => store.get(key) || null,
    mget: async (...keys) => keys.map(k => (store.has(k) ? store.get(k) : null)),
    set: async (key, val) => { store.set(key, val); return 'OK'; },
    setex,
    del,
    incr: async (key) => {
      const next = (parseInt(store.get(key), 10) || 0) + 1;
      store.set(key, String(next));
      return next;
    },
    expire: async () => 1,
    publish: async (channel, message) => {
      published.push({ channel, message });
      return 1;
    },
    xadd,
    xgroup: async () => 'OK',
    xreadgroup: async () => null,
    xack: async () => 1,
    xautoclaim: async () => ['0-0', [], []],
    ping: async () => 'PONG',
    quit: async () => 'OK',
    subscribe: (channel, cb) => { if (cb) cb(null); },
    on: () => {},
    pipeline: () => {
      const commands = [];
      const api = {
        setex: (k, ttl, v) => { commands.push(['setex', k, v]); return api; },
        del: (...keys) => { commands.push(['del', keys]); return api; },
        xadd: (stream, id, ...fields) => { commands.push(['xadd', stream, fields]); return api; },
        exec: async () => {
          for (const [cmd, ...args] of commands) {
            if (cmd === 'setex') store.set(args[0], args[1]);
            if (cmd === 'del') args[0].forEach(k => store.delete(k));
            if (cmd === 'xadd') {
              const [stream, fields] = args;
              const event = { stream, id: '*' };
              for (let i = 0; i < fields.length; i += 2) event[fields[i]] = fields[i + 1];
              streamEvents.push(event);
            }
          }
          return [];
        },
      };
      return api;
    },
    _store: store,
    _published: published,
    _streamEvents: streamEvents,
  };
}
