/**
 * The last vehicle search a visitor ran on this browser, so the home page can
 * offer to return them to it. Only ever written when `getCookieConsent()` is
 * `'accepted'` — the call sites check that, not this module, so a decline
 * unambiguously means nothing here is ever read from or written to.
 */
const LAST_SEARCH_KEY = 'vintrax-last-search';

/** A `VehicleFilters` query string, e.g. what `filtersToParams(...).toString()` returns. */
export function saveLastSearch(query: string): void {
  try {
    window.localStorage.setItem(LAST_SEARCH_KEY, query);
  } catch {
    // Not worth surfacing — the search still ran, it just is not remembered.
  }
}

export function getLastSearch(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEARCH_KEY);
  } catch {
    return null;
  }
}

export function clearLastSearch(): void {
  try {
    window.localStorage.removeItem(LAST_SEARCH_KEY);
  } catch {
    // Nothing to do — if the store is inaccessible, there is nothing to clear.
  }
}
