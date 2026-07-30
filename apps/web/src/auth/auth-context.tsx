import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, LoginInput, PublicUser, RegisterInput } from '@atlas/shared';
import { api, setSessionExpiredHandler, tokenStore } from '../lib/api-client';

interface AuthContextValue {
  user: PublicUser | null;
  /** True until the stored session has been checked on first load. */
  isLoading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  canSell: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  // Restore the session from the stored token on first mount.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (!tokenStore.access) {
        setIsLoading(false);
        return;
      }
      try {
        const me = await api.get<PublicUser>('/auth/me');
        if (!cancelled) setUser(me);
      } catch {
        // The client already cleared tokens if refreshing failed.
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // The API client cannot import React state, so it calls back on hard 401s.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      queryClient.clear();
    });
  }, [queryClient]);

  const adopt = useCallback(
    (response: AuthResponse) => {
      tokenStore.set(response);
      setUser(response.user);
      // Cached anonymous responses (favourite flags, inbox) are now stale.
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const login = useCallback(
    async (input: LoginInput) => adopt(await api.post<AuthResponse>('/auth/login', input)),
    [adopt],
  );

  const register = useCallback(
    async (input: RegisterInput) => adopt(await api.post<AuthResponse>('/auth/register', input)),
    [adopt],
  );

  const logout = useCallback(async () => {
    const refreshToken = tokenStore.refresh;
    if (refreshToken) {
      // Best effort: the local session ends regardless of the server's answer.
      await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    }
    tokenStore.clear();
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      login,
      register,
      logout,
      canSell: user?.role === 'DEALER' || user?.role === 'PRIVATE_SELLER' || user?.role === 'ADMIN',
    }),
    [user, isLoading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
