import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore the session on load. If the access token has expired, try ONE
  // refresh before giving up — otherwise an aged-out token logs the user out
  // even though the (long-lived) refresh token is still valid.
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const token = localStorage.getItem('access_token');
      if (!token) { setLoading(false); return; }
      try {
        let data;
        try {
          data = await api.getMe();
        } catch {
          const refreshed = await api.refreshSession();
          if (!refreshed) throw new Error('session expired');
          data = await api.getMe();
        }
        if (!cancelled) setUser(data);
      } catch {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  // Keep the access token fresh while the app is open (it lives ~60 min), so
  // data requests never 401 mid-session. Also refresh when the tab regains
  // focus after being backgrounded.
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => { api.refreshSession(); }, 20 * 60 * 1000);
    const onFocus = () => { api.refreshSession(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [user]);

  const login = async (email, password) => {
    const data = await api.login(email, password);
    localStorage.setItem('access_token', data.session.access_token);
    localStorage.setItem('refresh_token', data.session.refresh_token);
    setUser(data.user);
    return data;
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore logout errors
    }
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
