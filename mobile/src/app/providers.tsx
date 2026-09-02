'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { ApiError, setSessionExpiredHandler } from '@/lib/api-client';
import { useAuthStore } from '@/store/session';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Longer than the web app's: a phone on cellular pays for every
            // refetch, and this data does not change second to second. The
            // exception is live auctions, which subscribe to a socket instead.
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            // Coming back to a backgrounded tab on a phone is the common case,
            // and stale prices there are worth one request.
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
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
    // The shared client cannot import store state, so it calls back when a
    // session ends for good.
    setSessionExpiredHandler(() => {
      setUser(null);
      queryClient.clear();
    });
  }, [queryClient, setUser]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
