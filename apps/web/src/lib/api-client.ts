import type { ApiErrorBody, AuthResponse } from '@atlas/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

const ACCESS_TOKEN_KEY = 'atlas.accessToken';
const REFRESH_TOKEN_KEY = 'atlas.refreshToken';

/**
 * Error carrying the API's structured body, so forms can render field-level
 * messages instead of a single opaque string.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly details: Record<string, string[]>;

  constructor(status: number, message: string, details: Record<string, string[]> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  /** First message for a field, for rendering under the matching input. */
  fieldError(field: string): string | undefined {
    return this.details[field]?.[0];
  }
}

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },
  set(tokens: { accessToken: string; refreshToken: string }): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

/** Notifies the auth provider when a session ends because refreshing failed. */
type SessionExpiredListener = () => void;
let onSessionExpired: SessionExpiredListener = () => {};
export function setSessionExpiredHandler(listener: SessionExpiredListener): void {
  onSessionExpired = listener;
}

/**
 * Refresh is deduplicated: several requests failing with 401 at once share a
 * single refresh call rather than each rotating the token and invalidating
 * the others.
 */
let inFlightRefresh: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return false;

  inFlightRefresh ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as AuthResponse;
      tokenStore.set(data);
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so concurrent callers all observe this result.
      queueMicrotask(() => {
        inFlightRefresh = null;
      });
    }
  })();

  return inFlightRefresh;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Set for FormData uploads, where the browser must choose the boundary. */
  rawBody?: FormData;
  signal?: AbortSignal;
}

async function send(path: string, options: RequestOptions, retryOn401 = true): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = tokenStore.access;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    signal: options.signal,
  });

  if (response.status === 401 && retryOn401 && tokenStore.refresh) {
    const refreshed = await refreshSession();
    if (refreshed) return send(path, options, false);

    tokenStore.clear();
    onSessionExpired();
  }

  return response;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const error = payload as ApiErrorBody | undefined;
    throw new ApiError(
      response.status,
      error?.message ?? `Request failed with status ${response.status}`,
      error?.details ?? {},
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string) => apiRequest<T>(path, { method: 'PUT' }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiRequest<T>(path, { method: 'POST', rawBody: form });
  },
};
