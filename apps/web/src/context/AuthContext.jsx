import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authService } from "../services/auth.service.js";

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("loading");
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    authService
      .me()
      .then((data) => {
        if (!cancelled) setUser(data?.user ?? null);
      })
      .catch((error) => {
        if (!cancelled && error.status !== 401) {
          console.error("Session check failed:", error.message);
        }
      })
      .finally(() => {
        if (!cancelled) setStatus("ready");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // A 401 or a role-scoped 403 invalidates what this tab believes about the session:
  // re-read it, so ProtectedRoute can send the user to the right area (or to /login).
  useEffect(() => {
    let busy = false;

    async function recheckSession() {
      if (busy) return;
      busy = true;
      queryClient.clear();
      try {
        const data = await authService.me();
        setUser(data?.user ?? null);
      } catch {
        setUser(null);
      } finally {
        setStatus("ready");
        busy = false;
      }
    }

    window.addEventListener("auth:invalidate", recheckSession);
    return () => window.removeEventListener("auth:invalidate", recheckSession);
  }, [queryClient]);

  const login = useCallback(
    async (credentials) => {
      const data = await authService.login(credentials);
      queryClient.clear();
      setUser(data.user);
      setStatus("ready");
      return data.user;
    },
    [queryClient]
  );

  const refresh = useCallback(async () => {
    const data = await authService.me();
    setUser(data?.user ?? null);
    return data?.user ?? null;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch {
      // The session may already be gone; clearing local state is still correct.
    }
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  const value = useMemo(
    () => ({
      user,
      status,
      isLoading: status === "loading",
      isAuthenticated: Boolean(user),
      login,
      logout,
      refresh
    }),
    [user, status, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
