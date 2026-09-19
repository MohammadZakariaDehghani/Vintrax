/**
 * The vehicle comparison list, kept on this browser only.
 *
 * `localStorage`, the same wrapped-in-try/catch pattern as `last-search.ts`
 * and the browse page's own view-preference storage: private browsing and
 * blocked site data both throw on access, and a feature this small should
 * degrade to "not remembered" rather than crash the page.
 *
 * Unlike the last-search feature, this is not gated behind cookie consent.
 * A saved search is optional convenience — remembering what someone was
 * browsing for. A compare list is closer to a shopping cart: without it the
 * feature the shopper explicitly asked for (add a car, look at another,
 * still have the first one) simply does not work. That is "strictly
 * necessary" storage, the kind consent frameworks carve out, not tracking.
 */
const STORAGE_KEY = 'vintrax-compare';

export const MAX_COMPARE_VEHICLES = 4;

/**
 * Turns whatever was actually in storage into a safe id list — sliced to the
 * maximum, de-duplicated, and stripped of anything that isn't a plain
 * non-empty string. Kept separate from `readCompareIds` because this part
 * (unlike a real `window.localStorage.getItem` call) takes no browser global
 * and so can run under this project's Node-only test environment; see
 * `compare-storage.spec.ts`.
 */
export function parseStoredIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
    // De-duplicated too: an id appearing twice in a hand-edited or corrupted
    // value must not count twice against the four-vehicle limit.
    return Array.from(new Set(ids)).slice(0, MAX_COMPARE_VEHICLES);
  } catch {
    return [];
  }
}

export function readCompareIds(): string[] {
  try {
    return parseStoredIds(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function writeCompareIds(ids: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_COMPARE_VEHICLES)));
  } catch {
    // Not worth surfacing — the selection still works for this tab, it just is not remembered.
  }
}
