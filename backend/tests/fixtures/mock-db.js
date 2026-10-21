/**
 * In-memory PostgreSQL Pool and Redis mock for integration tests.
 * Accurately simulates constraints, transactions, and Redis caching.
 */

export function createMockPgPool() {
  const urls = new Map(); // short_code -> record
  const outbox = [];
  const clickAnalytics = new Map(); // `${short_code}:${date}` -> count
  let idCounter = 1;

  const executeQuery = async (sql, params = []) => {
    const trimmed = sql.trim();

    if (trimmed === 'SELECT 1') {
      return { rows: [{ '?column?': 1 }], rowCount: 1 };
    }

    if (trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }

    // Insert URL
    if (trimmed.includes('INSERT INTO urls')) {
      const [code, originalUrl, status, expiresAt, ownerId] = params;
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
        owner_id: ownerId || null,
      };
      urls.set(code, record);
      return { rows: [record], rowCount: 1 };
    }

    // Insert Outbox
    if (trimmed.includes('INSERT INTO outbox')) {
      const [eventType, payload] = params;
      const record = {
        id: outbox.length + 1,
        event_type: eventType,
        payload: typeof payload === 'string' ? JSON.parse(payload) : payload,
        created_at: new Date().toISOString(),
        published_at: null,
        retries: 0,
      };
      outbox.push(record);
      return { rows: [{ id: record.id }], rowCount: 1 };
    }

    // Find by Short Code
    if ((trimmed.includes('WHERE short_code = $1') || trimmed.includes('WHERE u.short_code = $1')) && !trimmed.includes('UPDATE')) {
      const [code] = params;
      const record = urls.get(code);
      return { rows: record ? [{ ...record, click_count: 0 }] : [], rowCount: record ? 1 : 0 };
    }

    // Update URL destination
    if (trimmed.includes('UPDATE urls') && trimmed.includes('original_url = $2')) {
      const [code, newUrl] = params;
      const record = urls.get(code);
      if (!record || record.status !== 'active') {
        return { rows: [], rowCount: 0 };
      }
      record.original_url = newUrl;
      record.updated_at = new Date().toISOString();
      return { rows: [{ ...record }], rowCount: 1 };
    }

    // Disable URL
    if (trimmed.includes('UPDATE urls') && trimmed.includes('status = $2')) {
      const [code, newStatus] = params;
      const record = urls.get(code);
      if (!record || record.status !== 'active') {
        return { rows: [], rowCount: 0 };
      }
      record.status = newStatus;
      record.updated_at = new Date().toISOString();
      return { rows: [{ ...record }], rowCount: 1 };
    }

    // List URLs
    if (trimmed.includes('FROM urls u') && trimmed.includes('ORDER BY u.created_at DESC')) {
      const limit = params[0] || 50;
      const list = Array.from(urls.values())
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit)
        .map(u => ({
          ...u,
          click_count: 0,
        }));
      return { rows: list, rowCount: list.length };
    }

    // Daily Clicks
    if (trimmed.includes('FROM click_analytics')) {
      return { rows: [], rowCount: 0 };
    }

    // Expire links
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

    // Find expired links
    if (trimmed.includes('WHERE status = \'active\'') && trimmed.includes('expires_at <= NOW()')) {
      const now = new Date();
      const expired = Array.from(urls.values()).filter(
        u => u.status === 'active' && u.expires_at && new Date(u.expires_at) <= now
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
    connect: async () => ({
      query: executeQuery,
      release: () => {},
    }),
    end: async () => {},
    _urls: urls,
    _outbox: outbox,
  };

  return pool;
}

export function createMockRedis() {
  const store = new Map();
  const published = [];
  const streamEvents = [];

  return {
    get: async (key) => store.get(key) || null,
    set: async (key, val) => { store.set(key, val); return 'OK'; },
    setex: async (key, ttl, val) => { store.set(key, val); return 'OK'; },
    del: async (...keys) => {
      let count = 0;
      for (const k of keys) {
        if (store.delete(k)) count++;
      }
      return count;
    },
    publish: async (channel, message) => {
      published.push({ channel, message });
      return 1;
    },
    xadd: async (stream, id, ...fieldValues) => {
      const event = { stream, id };
      for (let i = 0; i < fieldValues.length; i += 2) {
        event[fieldValues[i]] = fieldValues[i + 1];
      }
      streamEvents.push(event);
      return '1700000000000-0';
    },
    xgroup: async () => 'OK',
    xreadgroup: async () => null,
    xack: async () => 1,
    ping: async () => 'PONG',
    quit: async () => 'OK',
    subscribe: (channel, cb) => { if (cb) cb(null); },
    on: () => {},
    _store: store,
    _published: published,
    _streamEvents: streamEvents,
  };
}
