import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  RemoteImageError,
  ipv4First,
  isPrivateAddress,
  normalisePhotoUrl,
  requestOnce,
  retryUserAgent,
  sniff,
} from './remote-image';

/**
 * The importer's server-side request forgery defence.
 *
 * These are the tests that matter most in the inventory feature. Everything
 * else in it can be wrong in ways that produce a bad listing; this can be wrong
 * in a way that turns "upload your stock list" into "read anything our network
 * can reach". Each case below is an actual technique, not a shape.
 */

describe('normalisePhotoUrl', () => {
  it('accepts an ordinary feed photo', () => {
    expect(normalisePhotoUrl('https://photos.example.ca/vehicles/6416/a.jpg')).toBe(
      'https://photos.example.ca/vehicles/6416/a.jpg',
    );
  });

  it('refuses schemes that are not http or https', () => {
    // file: reads the API server's own disk. data: inlines bytes past every
    // size and type check further down. The rest are request-smuggling shapes.
    for (const url of [
      'file:///etc/passwd',
      'data:image/png;base64,iVBORw0KGgo=',
      'gopher://127.0.0.1:6379/_SET%20x%20y',
      'ftp://example.com/a.jpg',
      'jar:http://example.com/a.zip!/a.jpg',
      'javascript:alert(1)',
    ]) {
      expect(normalisePhotoUrl(url)).toBeNull();
    }
  });

  it('refuses a non-standard port', () => {
    // How a probe reaches an internal service that happens to be routable.
    expect(normalisePhotoUrl('http://example.com:6379/a.jpg')).toBeNull();
    expect(normalisePhotoUrl('http://example.com:22/a.jpg')).toBeNull();
    expect(normalisePhotoUrl('https://example.com:443/a.jpg')).not.toBeNull();
    expect(normalisePhotoUrl('http://example.com:80/a.jpg')).not.toBeNull();
  });

  it('strips credentials rather than spending them', () => {
    const url = normalisePhotoUrl('https://user:secret@photos.example.ca/a.jpg');
    expect(url).not.toBeNull();
    expect(url).not.toContain('secret');
    expect(url).not.toContain('user');
  });

  it('refuses text that is not a URL at all', () => {
    for (const value of ['', '   ', 'not a url', '/relative/path.jpg', undefined, null]) {
      expect(normalisePhotoUrl(value)).toBeNull();
    }
  });
});

describe('isPrivateAddress', () => {
  it('allows ordinary public addresses', () => {
    for (const address of ['1.1.1.1', '8.8.8.8', '104.18.32.7', '2606:4700::6810:85e5']) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });

  it('refuses the cloud metadata service', () => {
    // The single most valuable target of an SSRF: instance credentials.
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('fd00:ec2::254')).toBe(true);
  });

  it('refuses loopback, private and link-local ranges', () => {
    for (const address of [
      '127.0.0.1',
      '127.1.1.1',
      '0.0.0.0',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',
      '169.254.1.1',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
  });

  it('refuses private addresses wearing an IPv6 mapping', () => {
    // Skipping the unwrap is the usual way a check like this is defeated.
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::FFFF:10.0.0.1')).toBe(true);
  });

  it('refuses IPv4-in-IPv6 tunnel prefixes rather than translating them', () => {
    expect(isPrivateAddress('64:ff9b::7f00:1')).toBe(true);
    expect(isPrivateAddress('2002:7f00:0001::')).toBe(true);
  });

  it('treats anything it cannot parse as private', () => {
    // Fails closed. An address shape nobody anticipated is not waved through.
    for (const address of ['', 'localhost', '10.0.0', '999.1.1.1', 'not-an-ip', '0x7f000001']) {
      expect(isPrivateAddress(address)).toBe(true);
    }
  });

  it('allows the public neighbours of blocked ranges', () => {
    // A range check that is one octet too wide silently breaks real feeds.
    expect(isPrivateAddress('11.0.0.1')).toBe(false);
    expect(isPrivateAddress('172.15.0.1')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('192.167.0.1')).toBe(false);
    expect(isPrivateAddress('100.63.255.255')).toBe(false);
    expect(isPrivateAddress('100.128.0.1')).toBe(false);
  });
});

describe('sniff', () => {
  const pad = (head: number[]) => Buffer.concat([Buffer.from(head), Buffer.alloc(16)]);

  it('identifies the image types storage accepts', () => {
    expect(sniff(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniff(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe(
      'image/webp',
    );
    expect(sniff(Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('avif')]))).toBe(
      'image/avif',
    );
  });

  it('refuses a file that is not an image whatever the server called it', () => {
    // The remote server chooses the Content-Type header, so it is not evidence.
    // An HTML error page served as image/jpeg is the common real case; a PDF or
    // a script stored as a vehicle photo is the interesting one.
    expect(sniff(Buffer.from('<!DOCTYPE html><html>not an image</html>'))).toBeNull();
    expect(sniff(Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'))).toBeNull();
    expect(sniff(Buffer.from('GIF89a' + '\0'.repeat(16)))).toBeNull();
  });

  it('refuses a file too short to identify', () => {
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
    expect(sniff(Buffer.alloc(0))).toBeNull();
  });
});

describe('the transport', () => {
  /**
   * Pointed at a local server, because the parts worth testing here — the size
   * cap, the redirect handling, the status handling — cannot be exercised
   * against the public internet without depending on someone else's uptime.
   *
   * `requestOnce` deliberately performs no address check; `fetchRemoteImage`
   * does that before ever calling it. Reaching it directly is how the transport
   * gets tested without one, not a way round the gate.
   */
  let server: Server;
  let port = 0;
  let lastHeaders: Record<string, string | string[] | undefined> = {};

  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);

  beforeAll(async () => {
    server = createServer((request, response) => {
      lastHeaders = request.headers;
      if (request.url === '/photo.jpg') {
        response.writeHead(200, { 'content-type': 'image/jpeg' });
        response.end(JPEG);
      } else if (request.url === '/huge.jpg') {
        response.writeHead(200, { 'content-type': 'image/jpeg' });
        response.end(Buffer.alloc(2 * 1024 * 1024, 1));
      } else if (request.url === '/chunked.jpg') {
        // No Content-Length at all, sent in chunks. The cap has to hold on what
        // arrives rather than on what the headers promised, because a chunked
        // response promises nothing.
        response.writeHead(200, { 'content-type': 'image/jpeg' });
        for (let i = 0; i < 40; i += 1) response.write(Buffer.alloc(32 * 1024, 2));
        response.end();
      } else if (request.url === '/moved') {
        response.writeHead(302, { location: '/photo.jpg' });
        response.end();
      } else if (request.url === '/moved-nowhere') {
        response.writeHead(302);
        response.end();
      } else {
        response.writeHead(404);
        response.end('nope');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const call = (path: string, maxBytes = 1024 * 1024) =>
    requestOnce(
      new URL(`http://127.0.0.1:${port}${path}`),
      [{ address: '127.0.0.1', family: 4 }],
      Date.now() + 5_000,
      maxBytes,
    );

  it('reads a body', async () => {
    const result = await call('/photo.jpg');

    expect(result.kind).toBe('body');
    expect(result.kind === 'body' && result.body.equals(JPEG)).toBe(true);
  });

  it('reports a redirect rather than following it itself', async () => {
    // Following happens a level up, where each hop is re-checked against the
    // address gate. A transport that followed redirects on its own would skip
    // that check for every hop after the first.
    const result = await call('/moved');

    expect(result).toEqual({ kind: 'redirect', location: '/photo.jpg' });
  });

  it('rejects a redirect with no destination', async () => {
    await expect(call('/moved-nowhere')).rejects.toThrow(/no location/i);
  });

  it('rejects a non-200 answer, saying which', async () => {
    await expect(call('/missing.jpg')).rejects.toThrow(/HTTP 404/);
  });

  it('stops a body that exceeds the cap', async () => {
    await expect(call('/huge.jpg', 64 * 1024)).rejects.toThrow(/larger than/i);
  });

  it('enforces the cap on a response that declares no length', async () => {
    await expect(call('/chunked.jpg', 64 * 1024)).rejects.toThrow(/larger than/i);
  });

  it('asks for an identity encoding, so a small response cannot expand past the cap', async () => {
    // The body is read into memory. A gzip stream would be under the cap on the
    // wire and over it once decoded, which is a decompression bomb.
    await call('/photo.jpg');

    expect(lastHeaders['accept-encoding']).toBe('identity');
  });

  it("identifies itself, so a dealer's host can see and block us", async () => {
    await call('/photo.jpg');

    expect(String(lastHeaders['user-agent'])).toContain('Vintrax');
  });
  /** A narrow list drew 406 from hosts that negotiate; the bytes are sniffed anyway. */
  it('accepts what a browser accepts for an image', async () => {
    await call('/photo.jpg');

    expect(String(lastHeaders['accept'])).toContain('image/*');
  });

  it('can name itself as a browser for the retry after a refusal', async () => {
    const browser = retryUserAgent(new RemoteImageError('the server answered HTTP 403', 403));
    await requestOnce(
      new URL(`http://127.0.0.1:${port}/photo.jpg`),
      [{ address: '127.0.0.1', family: 4 }],
      Date.now() + 5_000,
      1024 * 1024,
      browser!,
    );

    expect(String(lastHeaders['user-agent'])).toMatch(/^Mozilla\/5\.0/);
    // Still says who it is, at the end, for anyone reading the logs.
    expect(String(lastHeaders['user-agent'])).toContain('Vintrax');
  });
});

/**
 * Photo CDNs in front of dealer systems commonly refuse anything that is not
 * a browser, and a network blip should not cost a listing its photo. Neither
 * should turn into hammering a host that said no for a reason.
 */
describe('when a download is retried', () => {
  it('retries a refusal once, as a browser', () => {
    for (const status of [401, 403, 406, 429]) {
      expect(retryUserAgent(new RemoteImageError('refused', status))).toMatch(/^Mozilla/);
    }
  });

  it('retries a momentary failure once, as itself', () => {
    expect(retryUserAgent(new RemoteImageError('timed out', undefined, true))).toContain(
      'Vintrax-InventoryImporter',
    );
    expect(retryUserAgent(new RemoteImageError('HTTP 503', 503, true))).toContain(
      'Vintrax-InventoryImporter',
    );
  });

  it('does not retry what another try would only repeat', () => {
    expect(retryUserAgent(new RemoteImageError('the server answered HTTP 404', 404))).toBeNull();
    expect(retryUserAgent(new RemoteImageError('address is not publicly routable'))).toBeNull();
    expect(retryUserAgent(new RemoteImageError('not a JPEG, PNG, WebP or AVIF image'))).toBeNull();
    expect(retryUserAgent(new Error('something else'))).toBeNull();
  });
});

/** A Docker network usually has no IPv6 route; a dual-stack host must not fail every photo. */
describe('the address a download connects to', () => {
  it('tries IPv4 before IPv6, keeping the resolver order within each', () => {
    expect(
      ipv4First([
        { address: '2606:4700::1', family: 6 },
        { address: '104.18.1.1', family: 4 },
        { address: '2606:4700::2', family: 6 },
        { address: '104.18.1.2', family: 4 },
      ]).map((entry) => entry.address),
    ).toEqual(['104.18.1.1', '104.18.1.2', '2606:4700::1', '2606:4700::2']);
  });
});
