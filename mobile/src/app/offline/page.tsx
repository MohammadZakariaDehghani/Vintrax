import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';

export const metadata: Metadata = { title: 'Offline' };

/**
 * The service worker serves this when a navigation fails with no network. It
 * is deliberately static — no data, no retry loop — so it renders from cache
 * with nothing available.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-8 text-center">
      <WifiOff aria-hidden className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold">You are offline</h1>
      <p className="text-sm text-muted-foreground">
        Atlas needs a connection to show inventory and auctions. Pages you already opened are still
        available.
      </p>
      <p className="text-sm text-muted-foreground">This page will work again once you reconnect.</p>
    </div>
  );
}
