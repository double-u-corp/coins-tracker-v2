import { useCallback, useEffect, useState } from "react";

interface AuthState {
  authenticated: boolean;
  loading: boolean;
}

export function useAuth() {
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

  return { ...state, login, logout, refresh };
}
