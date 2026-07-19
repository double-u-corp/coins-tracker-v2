import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

interface AuthState {
  authenticated: boolean;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds ONE shared auth state for the whole app. This exists because
 * `useAuth()` used to manage its own local state per call site — fine
 * while every consumer mounted fresh on each navigation, but broke once
 * `Layout` moved into `_app.tsx` (see Gotcha #1) and started persisting
 * across route changes: Layout's copy of the state was set once on initial
 * load (before login) and never told about a later login/logout happening
 * elsewhere, while other components that remounted after the post-login
 * redirect picked up the new state fine — producing exactly the symptom
 * reported: Home's "Run Cron Now" (gated by a fresh useHomeLogic mount)
 * showed up after login, but Layout's nav links (Buy/Sell, Manage Coins)
 * did not, because Layout's own useAuth() instance was never updated.
 *
 * Wrap the app once with <AuthProvider> (done in _app.tsx) and every
 * useAuth() call below reads from that single instance instead of
 * fetching independently — login()/logout() from anywhere updates state
 * every consumer sees on its next render, including Layout.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ authenticated: false, loading: true });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = (await res.json()) as { authenticated: boolean };
      setState({ authenticated: data.authenticated, loading: false });
    } catch {
      setState({ authenticated: false, loading: false });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function login(username: string, password: string): Promise<string | null> {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = (await res.json()) as { ok?: true; error?: string };
    if (!res.ok || !data.ok) {
      return data.error ?? "Login failed";
    }
    await refresh();
    return null;
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    await refresh();
  }

  return <AuthContext.Provider value={{ ...state, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth() must be called within <AuthProvider> — check that _app.tsx wraps the app with it.");
  }
  return ctx;
}