'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import type { Locale } from '@/i18n/dictionary';
import { LocaleProvider } from '@/i18n/provider';
import { ApiError, setSessionExpiredHandler } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';

export function Providers({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Retrying a 4xx just repeats the same rejection.
              if (error instanceof ApiError && error.status < 500) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  const restore = useAuthStore((state) => state.restore);
  const setUser = useAuthStore((state) => state.setUser);

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    // The API client cannot import store state, so it calls back on hard 401s.
    setSessionExpiredHandler(() => {
      setUser(null);
      queryClient.clear();
    });
  }, [queryClient, setUser]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <LocaleProvider initialLocale={initialLocale}>{children}</LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
