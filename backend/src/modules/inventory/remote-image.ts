import { lookup as dnsLookup } from 'node:dns';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { LookupAddress } from 'node:dns';

/**
 * Downloading a photo whose address came from an uploaded file.
 *
 * This is the only place in the application where a URL a user supplied causes
 * the server to make a request, which makes it the application's server-side
 * request forgery surface in its entirety. A dealer CSV is not hostile by
 * default, but it is written by a third-party system and edited in a
 * spreadsheet, and "our importer will fetch any URL you put in column 29" is a
 * way to read the metadata service, the Redis port, or anything else reachable
 * from inside the network but not from outside it.
 *
 * Four gates, in order:
 *
 *   1. The text.      http and https only, standard ports only, no credentials.
 *   2. The address.   Every IP the hostname resolves to is checked against the
 *                     private, loopback, link-local and reserved ranges — and
 *                     the socket is then pinned to an address that passed, so a
 *                     name that resolves differently on the second lookup
 *                     cannot be used to rebind onto one that did not.
 *   3. The response.  Redirects are followed by hand, at most three, each hop
 *                     re-entering gate 1 and 2. A redirect to `file:` or to
 *                     169.254.169.254 is how gate 2 gets bypassed otherwise.
 *   4. The bytes.     Size capped while streaming, not after; the content type
 *                     is taken from the file's magic number rather than from
 *                     the header, which the remote server chooses.
 *
 * Nothing here trusts the remote server, including about how big its own file
 * is: `Content-Length` is a hint, and the cap is enforced on what arrives.
 */

/** What a successful download produced. */
export interface RemoteImage {
  buffer: Buffer;
  /** Sniffed from the bytes, not read from the response header. */
  contentType: string;
  /** The address actually downloaded from, after any redirects. */
  finalUrl: string;
}

export class RemoteImageError extends Error {}

const MAX_REDIRECTS = 3;
const CONNECT_TIMEOUT_MS = 8_000;
const TOTAL_TIMEOUT_MS = 20_000;

/** Magic numbers for the image types storage accepts. */
const SIGNATURES: ReadonlyArray<{ type: string; test: (bytes: Buffer) => boolean }> = [
  { type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: 'image/png',
    test: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    type: 'image/webp',
    test: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    type: 'image/avif',
    test: (b) =>
      b.subarray(4, 8).toString('ascii') === 'ftyp' &&
      b.subarray(8, 12).toString('ascii') === 'avif',
  },
];

/**
 * A photo URL as written in a feed, or null if it is not one we will fetch.
 *
 * The rejected schemes are the interesting ones: `file:` would read the API
 * server's own disk, `data:` would inline arbitrary bytes past every check
 * below, and `gopher:` and `ftp:` are classic request-smuggling shapes.
 * Credentials in the URL are stripped rather than honoured — a feed carrying
 * them is leaking them, and the importer should not be the thing that spends
 * them. A non-default port is how a probe reaches an internal service that
 * happens to be routable; a feed serves photos from a web server.
 */
export function normalisePhotoUrl(value: string | undefined | null): string | null {
  const text = value?.trim();
  if (!text) return null;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;

  url.username = '';
  url.password = '';
  url.hash = '';
  return url.toString();
}

/**
 * Whether an address belongs to a range that is only reachable from inside.
 *
 * The list is deny-by-range rather than allow-by-range because the public
 * internet is the complement of a small, enumerable set, and getting that set
 * wrong fails closed here: an unrecognised shape is treated as private.
 *
 * IPv4-mapped IPv6 (`::ffff:10.0.0.1`) is unwrapped first. Skipping that step
 * is the usual way one of these checks is defeated.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;

  if (family === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);

    if (lower === '::' || lower === '::1') return true;
    // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
    if (/^f[cd]/.test(lower)) return true;
    if (/^fe[89ab]/.test(lower)) return true;
    if (/^ff/.test(lower)) return true;
    // 64:ff9b::/96 and 2002::/16 tunnel IPv4; refuse rather than translate.
    if (lower.startsWith('64:ff9b:') || lower.startsWith('2002:')) return true;
    return false;
  }

  const parts = address.split('.').map(Number);
  const [a, b] = parts as [number, number, number, number];
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;

  if (a === 0) return true; // this network
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast and reserved, incl. 255.255.255.255
  return false;
}

/**
 * Resolves a hostname and returns only addresses safe to connect to.
 *
 * Every address is checked, not just the first: a hostname that resolves to
 * both a public and a private address would otherwise be usable by retrying
 * until the resolver returns the one that is wanted.
 */
async function resolveSafely(hostname: string): Promise<LookupAddress[]> {
  if (isIP(hostname) !== 0) {
    if (isPrivateAddress(hostname)) {
      throw new RemoteImageError('address is not publicly routable');
    }
    return [{ address: hostname, family: isIP(hostname) }];
  }

  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    dnsLookup(hostname, { all: true }, (error, result) => {
      if (error) reject(new RemoteImageError(`could not resolve ${hostname}`));
      else resolve(result);
    });
  });

  if (addresses.length === 0) {
    throw new RemoteImageError(`could not resolve ${hostname}`);
  }
  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) {
      throw new RemoteImageError('address is not publicly routable');
    }
  }
  return addresses;
}

interface FetchOptions {
  /** Hard cap on bytes accepted, enforced while the body streams. */
  maxBytes: number;
  /** Cuts the whole attempt off, redirects included. */
  deadline?: number;
}

/** Downloads one image, or throws a `RemoteImageError` saying why it did not. */
export async function fetchRemoteImage(
  rawUrl: string,
  options: FetchOptions,
): Promise<RemoteImage> {
  const deadline = options.deadline ?? Date.now() + TOTAL_TIMEOUT_MS;
  let target = normalisePhotoUrl(rawUrl);
  if (!target) throw new RemoteImageError('not an http(s) image URL');

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (Date.now() > deadline) throw new RemoteImageError('timed out');

    const url = new URL(target);
    const addresses = await resolveSafely(url.hostname);
    const response = await requestOnce(url, addresses, deadline, options.maxBytes);

    if (response.kind === 'redirect') {
      const next = normalisePhotoUrl(new URL(response.location, url).toString());
      if (!next) throw new RemoteImageError('redirected somewhere that is not an http(s) URL');
      target = next;
      continue;
    }

    const contentType = sniff(response.body);
    if (!contentType) {
      throw new RemoteImageError('the downloaded file is not a JPEG, PNG, WebP or AVIF image');
    }
    return { buffer: response.body, contentType, finalUrl: target };
  }

  throw new RemoteImageError(`redirected more than ${MAX_REDIRECTS} times`);
}

export type RemoteResponse =
  { kind: 'redirect'; location: string } | { kind: 'body'; body: Buffer };

/**
 * One request, to one vetted address.
 *
 * `lookup` is overridden to hand back an address that already passed
 * `resolveSafely` rather than resolving the name again at connect time. That
 * second resolution is the DNS rebinding window: the check and the connection
 * have to agree on the address, and this is what makes them.
 *
 * Exported for its tests, which point it at a local server to exercise the
 * size cap, the redirect handling and the status handling. It performs no
 * address check of its own and is only ever reached through
 * `fetchRemoteImage`, which does — calling it directly is not a way round the
 * gate, it is a way to test the transport without one.
 */
export function requestOnce(
  url: URL,
  addresses: LookupAddress[],
  deadline: number,
  maxBytes: number,
): Promise<RemoteResponse> {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === 'https:';
    const options: RequestOptions = {
      method: 'GET',
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (secure ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers: {
        // Named honestly. A dealer's host should be able to see who is pulling
        // their photos, and to block us if they want to.
        'user-agent': 'Vintrax-InventoryImporter/1 (+https://vintrax.ca)',
        accept: 'image/jpeg,image/png,image/webp,image/avif',
        // The body is read into memory, so a compressed stream would let a
        // small response expand past the cap after it was checked.
        'accept-encoding': 'identity',
      },
      // Node calls this with `all: true` on some connect paths and `all: false`
      // on others, and answering in the wrong shape fails with a misleading
      // "Invalid IP address: undefined". Both shapes are served.
      lookup: (_hostname, options, callback) => {
        const first = addresses[0];
        if (!first) {
          (callback as (error: Error | null) => void)(new RemoteImageError('no address'));
          return;
        }
        if (typeof options === 'object' && options !== null && options.all === true) {
          (callback as (error: Error | null, addresses: LookupAddress[]) => void)(null, addresses);
          return;
        }
        (callback as (error: Error | null, address: string, family: number) => void)(
          null,
          first.address,
          first.family,
        );
      },
    };

    const transport = secure ? httpsRequest : httpRequest;
    const request = transport(options, (message) => {
      const status = message.statusCode ?? 0;

      if (status >= 300 && status < 400) {
        const location = message.headers.location;
        message.destroy();
        if (!location) {
          reject(new RemoteImageError(`redirect with no location (HTTP ${status})`));
          return;
        }
        resolve({ kind: 'redirect', location });
        return;
      }

      if (status !== 200) {
        message.destroy();
        reject(new RemoteImageError(`the server answered HTTP ${status}`));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;

      message.on('data', (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > maxBytes) {
          message.destroy();
          reject(
            new RemoteImageError(
              `the photo is larger than ${Math.floor(maxBytes / 1024 / 1024)}MB`,
            ),
          );
          return;
        }
        chunks.push(chunk);
      });
      message.on('end', () => resolve({ kind: 'body', body: Buffer.concat(chunks) }));
      message.on('error', (error) => reject(new RemoteImageError(error.message)));
    });

    request.setTimeout(Math.min(CONNECT_TIMEOUT_MS, Math.max(1, deadline - Date.now())), () => {
      request.destroy(new RemoteImageError('timed out'));
    });
    request.on('error', (error) =>
      reject(error instanceof RemoteImageError ? error : new RemoteImageError(error.message)),
    );
    request.end();
  });
}

/** The content type the bytes actually are, or null if they are not an image. */
export function sniff(bytes: Buffer): string | null {
  if (bytes.byteLength < 12) return null;
  return SIGNATURES.find((signature) => signature.test(bytes))?.type ?? null;
}
