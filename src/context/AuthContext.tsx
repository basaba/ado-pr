import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { AdoConfig, IdentityRef } from '../types';
import { adoClient, getMyProfile } from '../api';

interface AuthState {
  config: AdoConfig | null;
  profile: IdentityRef | null;
  loading: boolean;
  error: string | null;
  login: (config: AdoConfig) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = 'ado-pr-config';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AdoConfig | null>(null);
  const [profile, setProfile] = useState<IdentityRef | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Restore from storage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as AdoConfig;
        adoClient.configure(parsed);
        setConfig(parsed);
        Promise.all([getMyProfile(), adoClient.resolveProjectId()])
          .then(([p]) => setProfile(p))
          .catch(() => {
            localStorage.removeItem(STORAGE_KEY);
          })
          .finally(() => setLoading(false));
      } catch {
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (cfg: AdoConfig) => {
    setLoading(true);
    setError(null);
    try {
      adoClient.configure(cfg);
      const [p] = await Promise.all([getMyProfile(), adoClient.resolveProjectId()]);
      setProfile(p);
      setConfig(cfg);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setConfig(null);
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider value={{ config, profile, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
