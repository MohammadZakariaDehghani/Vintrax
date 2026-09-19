'use client';

import { useEffect, useState } from 'react';
import { getCookieConsent, setCookieConsent } from '@/lib/cookie-consent';
import { clearLastSearch } from '@/lib/last-search';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/provider';

/**
 * Asked once, on whichever page a visitor first lands on.
 *
 * Nothing here reads `localStorage` during the initial render — that would
 * differ between the server (which has none) and the client, and React
 * would warn about the mismatch. The banner starts hidden and an effect
 * decides, after mount, whether a choice has already been made.
 *
 * Declining does not merely hide the banner: it clears anything the "resume
 * your last search" feature had already stored, since a decline is a
 * statement that nothing here should be remembered, not only that no more of
 * it should be collected from now on.
 *
 * Not fixed-positioned itself: `app/layout.tsx` renders this inside the same
 * fixed-to-the-viewport bottom stack as `CompareBar`, so the rare visitor who
 * has both on screen at once — a first visit where they have already started
 * comparing vehicles before answering this — sees the two stacked rather than
 * overlapping.
 */
export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);
  const t = useT();

  useEffect(() => {
    if (getCookieConsent() === null) setVisible(true);
  }, []);

  if (!visible) return null;

  function choose(consent: 'accepted' | 'declined') {
    setCookieConsent(consent);
    if (consent === 'declined') clearLastSearch();
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-label={t.cookies.title}
      className="border-t border-border bg-card p-4 shadow-lg"
    >
      <div className="container flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{t.cookies.title}.</span> {t.cookies.body}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => choose('declined')}>
            {t.cookies.decline}
          </Button>
          <Button size="sm" onClick={() => choose('accepted')}>
            {t.cookies.accept}
          </Button>
        </div>
      </div>
    </div>
  );
}
