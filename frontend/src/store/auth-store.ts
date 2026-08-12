'use client';

import type {
  AuthResponse,
  LoginInput,
  Permission,
  PublicUser,
  RegisterInput,
} from '@atlas/shared';
import { create } from 'zustand';
import { api, tokenStore } from '@/lib/api-client';

interface AuthState {
  user: PublicUser | null;
  /** True until the stored session has been checked on first load. */
  isLoading: boolean;
  restore: () => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: PublicUser | null) => void;
}

/**
 * Session state.
 *
 * Zustand rather than context because the session is read from deep in the
 * tree — the navbar, route guards, bid forms — and a store avoids threading a
 * provider value through every one of them.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  restore: async () => {
    if (!tokenStore.access) {
      set({ isLoading: false, user: null });
      return;
    }
    try {
      const user = await api.get<PublicUser>('/auth/me');
      set({ user, isLoading: false });
    } catch {
      // The API client already cleared tokens if refreshing failed.
      set({ user: null, isLoading: false });
    }
  },

  login: async (input) => {
    const response = await api.post<AuthResponse>('/auth/login', input);
    tokenStore.set(response);
    set({ user: response.user, isLoading: false });
  },

  register: async (input) => {
    const response = await api.post<AuthResponse>('/auth/register', input);
    tokenStore.set(response);
    set({ user: response.user, isLoading: false });
  },

  logout: async () => {
    const refreshToken = tokenStore.refresh;
    if (refreshToken) {
      // Best effort: the local session ends regardless of the server's answer.
      await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    }
    tokenStore.clear();
    set({ user: null });
  },

  setUser: (user) => set({ user }),
}));

/** Convenience selectors, so components subscribe to the narrowest slice. */
export const useUser = () => useAuthStore((state) => state.user);
export const useAuthLoading = () => useAuthStore((state) => state.isLoading);

export function useHasPermission(permission: Permission): boolean {
  return useAuthStore((state) => state.user?.permissions.includes(permission) ?? false);
}

export function useIsSeller(): boolean {
  return useAuthStore((state) => {
    const role = state.user?.role;
    return role === 'SELLER' || role === 'DEALER' || role === 'ADMIN' || role === 'SUPER_ADMIN';
  });
}

export function useIsAdmin(): boolean {
  return useAuthStore((state) => {
    const role = state.user?.role;
    return role === 'ADMIN' || role === 'SUPER_ADMIN';
  });
}
