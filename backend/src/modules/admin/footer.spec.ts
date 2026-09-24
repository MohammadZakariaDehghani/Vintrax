import { BadRequestException } from '@nestjs/common';
import {
  FOOTER_LINK_ICONS,
  ROLE_PERMISSIONS,
  normalizeFooterHref,
  replaceFooterSchema,
  siteSettingsSchema,
} from '@vintrax/shared';
import { AdminService } from './admin.service';

/**
 * The site footer is operator content on every page, not per-vehicle data.
 *
 * Two things have to hold, same as the body-type photographs: only an
 * operator may replace it, and a link's destination is restricted to schemes
 * a browser navigates rather than runs — a footer link is exactly the kind of
 * thing a hostile "contact us" entry would try to turn into a `javascript:`
 * payload or an open redirect off the site.
 */

describe('who may replace the footer', () => {
  it.each(['BUYER', 'SELLER', 'DEALER', 'INSPECTOR'] as const)('refuses %s', (role) => {
    expect(ROLE_PERMISSIONS[role]).not.toContain('content:manage');
  });

  it.each(['ADMIN', 'SUPER_ADMIN'] as const)('allows %s', (role) => {
    expect(ROLE_PERMISSIONS[role]).toContain('content:manage');
  });
});

describe('the write payload', () => {
  it('accepts a section with ordered links', () => {
    const parsed = replaceFooterSchema.parse({
      sections: [
        {
          title: 'About us',
          links: [
            { label: 'About Vintrax', href: '/about' },
            { label: 'Contact us', href: 'mailto:support@vintrax.ca' },
          ],
        },
      ],
    });

    expect(parsed.sections[0]?.links).toHaveLength(2);
  });

  it('accepts every icon', () => {
    for (const icon of FOOTER_LINK_ICONS) {
      const parsed = replaceFooterSchema.parse({
        sections: [{ title: 'Stay in touch', links: [{ label: 'Follow us', href: '/', icon }] }],
      });
      expect(parsed.sections[0]?.links[0]?.icon).toBe(icon);
    }
  });

  it('accepts an empty footer', () => {
    expect(replaceFooterSchema.parse({ sections: [] }).sections).toEqual([]);
  });

  it('accepts a section with no links yet', () => {
    const parsed = replaceFooterSchema.parse({ sections: [{ title: 'Partners', links: [] }] });
    expect(parsed.sections[0]?.links).toEqual([]);
  });

  it('requires a section title', () => {
    expect(() => replaceFooterSchema.parse({ sections: [{ title: '', links: [] }] })).toThrow();
  });

  it('requires a link label', () => {
    expect(() =>
      replaceFooterSchema.parse({
        sections: [{ title: 'Resources', links: [{ label: '', href: '/blog' }] }],
      }),
    ).toThrow();
  });

  it.each(['javascript:alert(1)', '//evil.example.com', 'ftp://files.example.com', ''])(
    'refuses %s as a link destination',
    (href) => {
      expect(() =>
        replaceFooterSchema.parse({
          sections: [{ title: 'Resources', links: [{ label: 'Bad link', href }] }],
        }),
      ).toThrow();
    },
  );

  it.each([
    '/vehicles',
    'https://facebook.com/vintrax',
    'mailto:support@vintrax.ca',
    'tel:+15555550100',
  ])('accepts %s as a link destination', (href) => {
    const parsed = replaceFooterSchema.parse({
      sections: [{ title: 'Resources', links: [{ label: 'Good link', href }] }],
    });
    expect(parsed.sections[0]?.links[0]?.href).toBe(href);
  });

  it('rejects an id in a section, which is assigned by the server', () => {
    expect(() =>
      replaceFooterSchema.parse({
        sections: [{ id: 'not-a-real-field', title: 'Resources', links: [] }],
      }),
    ).toThrow();
  });

  it('rejects an id in a link, which is assigned by the server', () => {
    expect(() =>
      replaceFooterSchema.parse({
        sections: [
          { title: 'Resources', links: [{ id: 'not-a-real-field', label: 'Blog', href: '/blog' }] },
        ],
      }),
    ).toThrow();
  });
});

/**
 * Pasting an address the way a browser's address bar shows it was refused,
 * and the footer silently would not save (the report: "when I add a URL it
 * does not work"). These are normalised instead.
 */
describe('a link destination as an administrator types it', () => {
  const hrefOf = (href: string) =>
    replaceFooterSchema.parse({
      sections: [{ title: 'Stay in touch', links: [{ label: 'Link', href }] }],
    }).sections[0]?.links[0]?.href;

  it.each([
    ['instagram.com/vintrax', 'https://instagram.com/vintrax'],
    ['www.facebook.com/vintrax', 'https://www.facebook.com/vintrax'],
    ['http://facebook.com/vintrax', 'https://facebook.com/vintrax'],
    ['  https://x.com/vintrax  ', 'https://x.com/vintrax'],
    ['support@vintrax.ca', 'mailto:support@vintrax.ca'],
    ['/pages/about-us', '/pages/about-us'],
    ['tel:+15145550100', 'tel:+15145550100'],
  ])('saves %s as %s', (typed, saved) => {
    expect(hrefOf(typed)).toBe(saved);
    expect(normalizeFooterHref(typed)).toBe(saved);
  });

  it('keeps refusing a script, whatever it is dressed as', () => {
    expect(() => hrefOf('javascript:alert(1)')).toThrow();
    expect(() => hrefOf('JaVaScRiPt:alert(1)')).toThrow();
    expect(() => hrefOf('data:text/html,hi')).toThrow();
  });
});

describe('where a section sits and what a link shows', () => {
  it('puts a section in column 1 unless told otherwise, and only in columns 1 to 4', () => {
    const parse = (column?: number) =>
      replaceFooterSchema.parse({ sections: [{ title: 'Partners', column, links: [] }] });
    expect(parse().sections[0]?.column).toBe(1);
    expect(parse(3).sections[0]?.column).toBe(3);
    expect(() => parse(0)).toThrow();
    expect(() => parse(5)).toThrow();
  });

  /** The icon image loads on every page for every visitor, so it has to be one Vintrax issued. */
  it('refuses an icon image from another server', async () => {
    const admin = new AdminService(
      {} as never,
      { del: jest.fn() } as never,
      { isOwnUrl: (url: string) => url.startsWith('/uploads/') } as never,
    );
    const input = replaceFooterSchema.parse({
      sections: [
        {
          title: 'Stay in touch',
          links: [
            {
              label: 'Instagram',
              href: 'instagram.com/vintrax',
              icon: 'INSTAGRAM',
              imageUrl: 'https://tracker.example/pixel.png',
            },
          ],
        },
      ],
    });
    await expect(admin.replaceFooter(input, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('the site settings', () => {
  it('keeps the address Contact-form messages go to out of the public view', async () => {
    const admin = new AdminService(
      {
        siteSettings: {
          findUnique: jest.fn().mockResolvedValue({
            footerCopyright: 'Vintrax.',
            footerNote: null,
            contactIntro: null,
            contactAddress: '1 Main St',
            contactPhone: null,
            contactEmail: 'hello@vintrax.ca',
            contactHours: null,
            contactMapImageUrl: null,
            contactRecipient: 'private-inbox@vintrax.ca',
            updatedAt: new Date('2026-09-24T00:00:00Z'),
          }),
        },
      } as never,
      { remember: (_key: string, _ttl: number, load: () => unknown) => load() } as never,
      {} as never,
    );

    const settings = await admin.publicSiteSettings();
    expect(settings).not.toHaveProperty('contactRecipient');
    expect(JSON.stringify(settings)).not.toContain('private-inbox');
    expect(settings.contactEmail).toBe('hello@vintrax.ca');
  });

  it('stores a blank field as nothing, so the page leaves it out', () => {
    const parsed = siteSettingsSchema.parse({
      contactPhone: '',
      contactEmail: '',
      footerNote: ' ',
    });
    expect(parsed.contactPhone).toBeNull();
    expect(parsed.contactEmail).toBeNull();
    expect(parsed.footerNote).toBeNull();
  });
});
