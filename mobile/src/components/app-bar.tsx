'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

/**
 * The top bar. `back` turns the title into a navigable header rather than
 * relying on the browser's own back affordance, which a standalone PWA does
 * not display.
 */
export function AppBar({
  title,
  back = false,
  action,
}: {
  title: string;
  back?: boolean;
  action?: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <header
      className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="mx-auto flex max-w-lg items-center gap-1 px-2 py-2">
        {back ? (
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Go back"
            className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg active:bg-secondary"
          >
            <ChevronLeft aria-hidden className="h-6 w-6" />
          </button>
        ) : (
          <span className="w-2" />
        )}
        <h1 className="flex-1 truncate px-1 text-lg font-semibold">{title}</h1>
        {action}
      </div>
    </header>
  );
}
