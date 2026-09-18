/**
 * Whether this browser has agreed to Vintrax remembering anything about it.
 *
 * `localStorage` rather than an actual `document.cookie`: the site has no
 * server-side reason to read this on a request, and every other per-browser
 * preference here (theme, result view, locale) already uses it. Wrapped in
 * try/catch because private browsing and blocked site data both throw on
 * access, the same reasoning `vehicles/page.tsx`'s view-preference storage
 * already documents.
 */
const CONSENT_KEY = 'vintrax-cookie-consent';

export type CookieConsent = 'accepted' | 'declined';

export function getCookieConsent(): CookieConsent | null {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === 'accepted' || value === 'declined' ? value : null;
  } catch {
    return null;
  }
}

export function setCookieConsent(value: CookieConsent): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Not worth surfacing — the choice just is not remembered next visit.
  }
}
