import { BadRequestException } from '@nestjs/common';
import {
  extractMapUrl,
  googleMapsEmbedUrl,
  isGoogleMapsShortLink,
  siteSettingsSchema,
} from '@vintrax/shared';
import { resolveGoogleMapsShortLink } from './google-maps-link';

const PLACE =
  'https://www.google.com/maps/place/CN+Tower/@43.6425662,-79.3870568,17z/data=!3m1!4b1!4m6!3m5!1s0x882b34d68b!8m2!3d43.6426!4d-79.3871!16z?entry=ttu';

describe('googleMapsEmbedUrl', () => {
  it('pins a place link at the place’s own coordinates and zoom', () => {
    expect(googleMapsEmbedUrl(PLACE)).toBe(
      'https://www.google.com/maps?q=43.6426%2C-79.3871&z=17&output=embed',
    );
  });

  it('keeps an "Embed a map" address, pasted alone or as the whole <iframe>', () => {
    const src = 'https://www.google.com/maps/embed?pb=!1m18!1m12!3d43.64!2d-79.38';
    const expected = `https://www.google.com/maps/embed?pb=${encodeURIComponent('!1m18!1m12!3d43.64!2d-79.38')}`;
    expect(googleMapsEmbedUrl(src)).toBe(expected);
    expect(
      googleMapsEmbedUrl(
        `<iframe src="${src}" width="600" height="450" style="border:0;"></iframe>`,
      ),
    ).toBe(expected);
  });

  it('reads searches, a country domain, and a bare map position', () => {
    expect(googleMapsEmbedUrl('https://maps.google.ca/maps?q=123+Main+St,+Toronto')).toBe(
      'https://www.google.com/maps?q=123%20Main%20St%2C%20Toronto&z=15&output=embed',
    );
    expect(
      googleMapsEmbedUrl('https://www.google.com/maps/search/?api=1&query=Vintrax%20Toronto'),
    ).toContain('q=Vintrax%20Toronto');
    expect(googleMapsEmbedUrl('https://www.google.com/maps/place/Some+Place/')).toContain(
      'q=Some%20Place',
    );
    expect(googleMapsEmbedUrl('https://www.google.com/maps/@43.6,-79.4,12z')).toBe(
      'https://www.google.com/maps?q=43.6%2C-79.4&z=12&output=embed',
    );
  });

  it('refuses directions, other sites, look-alike hosts and other schemes', () => {
    for (const url of [
      'https://www.google.com/maps/dir/A/B',
      'https://evil.example/maps/place/x',
      'https://www.google.com.evil.example/maps?q=x',
      'https://www.google.com/search?q=x',
      'javascript:alert(1)',
      'https://maps.app.goo.gl/AbC123',
      'not a link',
    ]) {
      expect(googleMapsEmbedUrl(url)).toBeNull();
    }
  });

  it('always frames www.google.com, whatever Google domain was pasted', () => {
    expect(googleMapsEmbedUrl('https://www.google.co.uk/maps?q=London')).toMatch(
      /^https:\/\/www\.google\.com\/maps\?/,
    );
  });
});

describe('short share links', () => {
  it('are recognised, and only on Google’s own short-link hosts', () => {
    expect(isGoogleMapsShortLink('https://maps.app.goo.gl/AbC123')).toBe(true);
    expect(isGoogleMapsShortLink('https://goo.gl/maps/AbC123')).toBe(true);
    expect(isGoogleMapsShortLink('https://goo.gl/other')).toBe(false);
    expect(isGoogleMapsShortLink('https://bit.ly/AbC123')).toBe(false);
  });

  function redirects(chain: Record<string, { status: number; location?: string }>) {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      const hop = chain[url] ?? { status: 404 };
      return new Response(null, {
        status: hop.status,
        headers: hop.location ? { location: hop.location } : {},
      });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it('are followed, one Google redirect at a time, to the place they stand for', async () => {
    const { calls, fetchImpl } = redirects({
      'https://maps.app.goo.gl/AbC123': { status: 302, location: PLACE },
    });
    await expect(
      resolveGoogleMapsShortLink('https://maps.app.goo.gl/AbC123', fetchImpl),
    ).resolves.toBe(PLACE);
    expect(calls).toEqual(['https://maps.app.goo.gl/AbC123']);
  });

  it('are not followed off Google', async () => {
    const { calls, fetchImpl } = redirects({
      'https://maps.app.goo.gl/AbC123': { status: 302, location: 'https://evil.example/maps?q=x' },
    });
    await expect(
      resolveGoogleMapsShortLink('https://maps.app.goo.gl/AbC123', fetchImpl),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(1);
  });

  it('give up on a dead link or an endless loop', async () => {
    const dead = redirects({});
    await expect(
      resolveGoogleMapsShortLink('https://maps.app.goo.gl/gone', dead.fetchImpl),
    ).rejects.toBeInstanceOf(BadRequestException);

    const loop = redirects({
      'https://maps.app.goo.gl/a': { status: 302, location: 'https://maps.app.goo.gl/b' },
      'https://maps.app.goo.gl/b': { status: 302, location: 'https://maps.app.goo.gl/a' },
    });
    await expect(
      resolveGoogleMapsShortLink('https://maps.app.goo.gl/a', loop.fetchImpl),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(loop.calls).toHaveLength(5);
  });

  it('turn a network failure into a message the administrator can act on', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      resolveGoogleMapsShortLink('https://maps.app.goo.gl/AbC123', failing),
    ).rejects.toThrow(/Embed a map/);
  });
});

describe('the contact map link setting', () => {
  const parse = (contactMapUrl: unknown) => siteSettingsSchema.safeParse({ contactMapUrl });

  it('accepts a place link, a share link and embed code, keeping only the address', () => {
    expect(parse(PLACE).data?.contactMapUrl).toBe(PLACE);
    expect(parse('https://maps.app.goo.gl/AbC123').success).toBe(true);
    expect(
      parse('<iframe src="https://www.google.com/maps/embed?pb=!1m2&amp;x=1"></iframe>').data
        ?.contactMapUrl,
    ).toBe('https://www.google.com/maps/embed?pb=!1m2&x=1');
  });

  it('stores a blank as no link', () => {
    expect(parse('').data?.contactMapUrl).toBeNull();
    expect(parse('   ').data?.contactMapUrl).toBeNull();
  });

  it('refuses anything that is not a Google Maps place', () => {
    const result = parse('https://evil.example/');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/Google Maps link/);
    expect(parse('https://www.google.com/maps/dir/A/B').success).toBe(false);
  });

  it('extracts the src of pasted embed code', () => {
    expect(extractMapUrl(" <iframe  src='https://www.google.com/maps/embed?pb=1'></iframe> ")).toBe(
      'https://www.google.com/maps/embed?pb=1',
    );
  });
});
