/**
 * Google Maps links an administrator pastes for the Contact page, and the
 * map the page embeds from them.
 *
 * Google only lets its `/maps/embed` and `output=embed` addresses load in a
 * frame; a place or share link opened in one shows a refusal. So the page
 * never frames what was pasted: it reads the place out of the link and frames
 * an embed address built here, always on www.google.com.
 */

/** google.com, google.ca, maps.google.com and the like. */
const GOOGLE_HOST = /^(?:www\.|maps\.)?google\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/;
/** The short links Google's Share button makes. */
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);
const DEFAULT_ZOOM = 15;

/** The `src` of a pasted `<iframe>`, or the text itself, trimmed. */
export function extractMapUrl(input: string): string {
  const text = input.trim();
  const src = /<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(text);
  return (src ? src[1]! : text).replace(/&amp;/g, '&').trim();
}

/** The parts of a WHATWG URL used here; the package is built without DOM types. */
interface MapUrl {
  protocol: string;
  hostname: string;
  pathname: string;
  searchParams: { get(name: string): string | null };
}
const MapUrlConstructor = (globalThis as unknown as { URL: new (input: string) => MapUrl }).URL;

function parse(url: string): MapUrl | null {
  try {
    const parsed = new MapUrlConstructor(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : null;
  } catch {
    return null;
  }
}

/** A maps.app.goo.gl (or goo.gl/maps) link, which has to be followed to find the place. */
export function isGoogleMapsShortLink(url: string): boolean {
  const parsed = parse(url);
  if (!parsed || !SHORT_HOSTS.has(parsed.hostname.toLowerCase())) return false;
  return parsed.hostname.toLowerCase() === 'maps.app.goo.gl' || parsed.pathname.startsWith('/maps');
}

/** A Google address a short link may pass through on its way to the place. */
export function isGoogleMapsHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return GOOGLE_HOST.test(host) || SHORT_HOSTS.has(host);
}

const decode = (segment: string) => {
  try {
    return decodeURIComponent(segment.replace(/\+/g, ' ')).trim();
  } catch {
    return segment.trim();
  }
};

const searchEmbed = (query: string, zoom = DEFAULT_ZOOM) =>
  `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=${zoom}&output=embed`;

/**
 * The address to frame for a Google Maps link, or null when the link is not
 * one this can place on a map (a route, a short link not yet followed, or not
 * Google Maps at all). Understands:
 *
 * - an "Embed a map" address or `<iframe>` (`/maps/embed?pb=…`), kept as it is;
 * - a place (`/maps/place/Name/@lat,lng,17z/data=…!3dLAT!4dLNG`), pinned at
 *   the place's own coordinates, or its name when they are missing;
 * - a search (`/maps/search/…`, `?q=…`, `?query=…`) and a bare `/maps/@lat,lng`.
 */
export function googleMapsEmbedUrl(input: string): string | null {
  const url = parse(extractMapUrl(input));
  if (!url || !GOOGLE_HOST.test(url.hostname.toLowerCase())) return null;
  const path = url.pathname;
  if (!path.startsWith('/maps')) return null;

  if (path.startsWith('/maps/embed')) {
    const pb = url.searchParams.get('pb');
    return pb ? `https://www.google.com/maps/embed?pb=${encodeURIComponent(pb)}` : null;
  }
  if (path.startsWith('/maps/dir')) return null;

  const view = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/.exec(path);
  const zoom = view?.[3] ? Math.round(Number(view[3])) : DEFAULT_ZOOM;

  const place = /^\/maps\/place\/([^/@]+)/.exec(path);
  if (place) {
    const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(path);
    if (pin) return searchEmbed(`${pin[1]},${pin[2]}`, zoom);
    return searchEmbed(decode(place[1]!), zoom);
  }

  const search = /^\/maps\/search\/([^/@]+)/.exec(path);
  if (search) return searchEmbed(decode(search[1]!), zoom);

  const query = url.searchParams.get('q') ?? url.searchParams.get('query');
  if (query?.trim()) return searchEmbed(query.trim(), zoom);

  if (view) return searchEmbed(`${view[1]},${view[2]}`, zoom);
  return null;
}
