import { FOOTER_LINK_ICONS, ROLE_PERMISSIONS, replaceFooterSchema } from '@vintrax/shared';

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

  it.each(['/vehicles', 'https://facebook.com/vintrax', 'mailto:support@vintrax.ca', 'tel:+15555550100'])(
    'accepts %s as a link destination',
    (href) => {
      const parsed = replaceFooterSchema.parse({
        sections: [{ title: 'Resources', links: [{ label: 'Good link', href }] }],
      });
      expect(parsed.sections[0]?.links[0]?.href).toBe(href);
    },
  );

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
