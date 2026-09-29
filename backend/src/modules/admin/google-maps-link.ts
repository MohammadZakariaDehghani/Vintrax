import { BadRequestException } from '@nestjs/common';
import { googleMapsEmbedUrl, isGoogleMapsHost } from '@vintrax/shared';

const MAX_HOPS = 5;
const TIMEOUT_MS = 5_000;

const UNREADABLE =
  'That Google Maps short link could not be opened. Open the place in Google Maps and copy the address from the browser’s address bar, or paste the code from Share → Embed a map.';

/**
 * Follows a maps.app.goo.gl share link to the full Google Maps link it stands
 * for, so the place can be read out of it.
 *
 * Redirects are followed by hand, one at a time, and only to Google's own
 * addresses: the API fetches nothing an administrator could point elsewhere.
 */
export async function resolveGoogleMapsShortLink(
  shortLink: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let current = shortLink;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    let response: Response;
    try {
      response = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new BadRequestException(UNREADABLE);
    }
    const location = response.headers.get('location');
    // Only the headers are wanted; let the connection go.
    await response.body?.cancel().catch(() => undefined);
    if (response.status < 300 || response.status >= 400 || !location) break;

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      break;
    }
    if (next.protocol !== 'https:' || !isGoogleMapsHost(next.hostname)) break;
    if (googleMapsEmbedUrl(next.toString()) !== null) return next.toString();
    current = next.toString();
  }
  throw new BadRequestException(UNREADABLE);
}
