import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { fetchMe, logoutAccount, subscribeSession } from '../api/client.js';

/**
 * Session context: one /api/auth/me probe per page load, kept in sync with
 * every sign-in / sign-out performed through the API client.
 */
const SessionContext = createContext({
  user: null,
  loading: true,
  refresh: async () => null,
  signOut: async () => {},
});

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await fetchMe();
      setUser(me);
      return me;
    } catch (err) {
      // A missing/expired session is a normal signed-out state.
      if (err?.status === 401) setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    refresh().then((me) => {
      if (cancelled) return;
      setUser(me ?? null);
    });
    const unsubscribe = subscribeSession((next) => setUser(next ?? null));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await logoutAccount();
    } catch {
      /* offline — drop local state anyway */
    }
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, refresh, signOut }),
    [user, loading, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}

export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
