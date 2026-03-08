import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { AdoConfig, IdentityRef } from '../types';
import { adoClient } from '../api';

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

async function checkAuthStatus(config: AdoConfig): Promise<IdentityRef> {
  const orgUrl = `${config.serverUrl.replace(/\/$/, '')}/${config.organization}`;
  const res = await fetch(`/auth/status?orgUrl=${encodeURIComponent(orgUrl)}`);
  const data = await res.json();
  if (!data.authenticated) {
    throw new Error(data.error || 'Azure CLI authentication failed. Run `az login` first.');
  }
  return {
    id: data.profile.id,
    displayName: data.profile.displayName,
    uniqueName: data.profile.displayName,
  };
}

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
        Promise.all([checkAuthStatus(parsed), adoClient.resolveProjectId()])
          .then(([p]) => setProfile(p))
          .catch(() => {
            localStorage.removeItem(STORAGE_KEY);
            setConfig(null);
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
      const [p] = await Promise.all([checkAuthStatus(cfg), adoClient.resolveProjectId()]);
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
