'use client';

import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

/**
 * Offline state, stated plainly.
 *
 * A dealership floor has dead spots. The rule this enforces is that the app
 * never pretends a write succeeded while offline — it says so, and the caller
 * decides. Nothing here queues or replays requests: a bid or a listing edit
 * silently replayed minutes later would be worse than a failure the user saw.
 */
export function useOnline(): boolean {
  // Assumed online for the first paint: navigator.onLine is unavailable during
  // server rendering, and flashing an offline banner on every load is worse
  // than a moment of optimism.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-warning px-4 py-2 text-sm font-medium text-warning-foreground"
    >
      <WifiOff aria-hidden className="h-4 w-4" />
      Offline — showing what was already loaded
    </div>
  );
}
