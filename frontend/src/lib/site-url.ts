/**
 * The site's public origin, for absolute URLs: canonical links, Open Graph
 * images, the sitemap and structured data. Read at request time on the
 * server — `SITE_URL`, else the `APP_URL` the API already uses for links in
 * emails — so one image serves any domain it is deployed on.
 */
export function siteUrl(): string {
  for (const candidate of [process.env['SITE_URL'], process.env['APP_URL']]) {
    // An unset compose variable arrives as an empty string, not undefined.
    if (!candidate?.trim()) continue;
    try {
      return new URL(candidate.trim()).origin;
    } catch {
      // Not a URL: try the next, rather than failing every page's metadata.
    }
  }
  return 'http://localhost:3000';
}

/** An absolute URL for a site path or an already-absolute URL. */
export function absoluteUrl(pathOrUrl: string): string {
  return /^https?:\/\//i.test(pathOrUrl)
    ? pathOrUrl
    : `${siteUrl()}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}
