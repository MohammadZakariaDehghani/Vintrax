import type { PublicUser } from '@vintrax/shared';

function isAdmin(user: PublicUser): boolean {
  return user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
}

function isSeller(user: PublicUser): boolean {
  return (
    user.role === 'SELLER' ||
    user.role === 'DEALER' ||
    user.role === 'ADMIN' ||
    user.role === 'SUPER_ADMIN'
  );
}

/**
 * Where to send someone right after they sign in, given a `from` the URL
 * actually carried — call sites keep their own default (`/dashboard`) for the
 * ordinary case of signing in with no `from` at all.
 *
 * `from` is set by whatever sent them to `/login` — usually `RequireAuth`,
 * capturing the page a signed-out visit landed on. Honoured only when the
 * account that just signed in could actually reach it; otherwise this falls
 * back to the home page.
 *
 * That fallback is the fix for a real bug: signing out of an admin screen and
 * back in as a dealer landed on that same admin URL, because the browser
 * still had `?from=/admin/...` from the earlier redirect and login trusted it
 * unconditionally. `RequireAuth` does check the role once the page renders,
 * but it never redirects on a role mismatch — it shows "Administrator access
 * required" in place, on that same URL — so without this check a plain
 * account switch reads as a permission error rather than what it is.
 *
 * The check only knows the two role tiers `RequireAuth` itself enforces
 * (`adminOnly`, `sellersOnly`) and applies them by the URL prefix those pages
 * actually live under. It does not need to be exhaustive to fix the bug: a
 * `from` this misses at worst gets a page that requires only being signed in,
 * which login always grants.
 */
export function postLoginRedirect(from: string, user: PublicUser): string {
  // Only ever redirect within the app. An absolute or protocol-relative
  // address in `from` would be an open redirect through a link nobody here
  // controls the wording of.
  if (!from.startsWith('/') || from.startsWith('//')) return '/';

  if (from.startsWith('/admin') && !isAdmin(user)) return '/';
  if ((from.startsWith('/dealer') || from.startsWith('/auctions/new')) && !isSeller(user)) {
    return '/';
  }

  return from;
}
