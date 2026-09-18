import type { PublicUser } from '@vintrax/shared';

/**
 * Where to send someone right after they sign in, given a `next` the URL
 * actually carried — call sites keep their own default (`/`) for the
 * ordinary case of signing in with no `next` at all.
 *
 * `next` is set by `RequireAuth`, capturing the screen a signed-out visit
 * landed on. Honoured only when the account that just signed in actually
 * holds the permission that screen requires; otherwise this falls back to
 * the home screen.
 *
 * That fallback is the fix for a real bug: signing out of the dealer
 * inventory screen and back in as a buyer landed on that same screen,
 * because the browser still had `?next=/dealer/inventory` from the earlier
 * redirect and login trusted it unconditionally. `RequireAuth` does check the
 * permission once the screen renders, but it never redirects on a mismatch —
 * it shows "Not available on this account" in place, on that same URL — so
 * without this check a plain account switch reads as a permission error
 * rather than what it is.
 *
 * Only `/dealer` is checked because it is the only prefix any screen here
 * gates on `vehicle:write` (see `dealer/inventory`); a `next` this misses at
 * worst lands on a screen that requires only being signed in, which login
 * always grants.
 */
export function postLoginRedirect(next: string, user: PublicUser): string {
  // Only ever redirect within the app. An absolute or protocol-relative
  // address in `next` would be an open redirect through a link nobody here
  // controls the wording of.
  if (!next.startsWith('/') || next.startsWith('//')) return '/';

  if (next.startsWith('/dealer') && !user.permissions.includes('vehicle:write')) {
    return '/';
  }

  return next;
}
