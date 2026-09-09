import { ROLE_PERMISSIONS, articleSchema, updateArticleSchema } from '@atlas/shared';

/**
 * Editorial posts are operator content on the busiest page of the site.
 *
 * Three rules matter, and all three are the kind that fail silently if nobody
 * pins them: only an operator may write one, the button may not leave Atlas,
 * and the payload may not carry anything the handler would spread into a
 * database write unexamined.
 */

const valid = {
  title: 'Winter tyres, honestly assessed',
  body: 'Some writing about cars.',
  heroImageUrl: '/uploads/articles/abc.jpg',
};

describe('who may write a post', () => {
  it.each(['BUYER', 'SELLER', 'DEALER', 'INSPECTOR'] as const)('refuses %s', (role) => {
    expect(ROLE_PERMISSIONS[role]).not.toContain('content:manage');
  });

  it.each(['ADMIN', 'SUPER_ADMIN'] as const)('allows %s', (role) => {
    expect(ROLE_PERMISSIONS[role]).toContain('content:manage');
  });
});

describe('the masthead button', () => {
  it('accepts a path on Atlas', () => {
    const parsed = articleSchema.parse({
      ...valid,
      ctaLabel: 'Browse SUVs',
      ctaHref: '/vehicles?bodyType=SUV',
    });

    expect(parsed.ctaHref).toBe('/vehicles?bodyType=SUV');
  });

  /**
   * The largest button on the site pointing at someone else's server is an
   * open redirect wearing Atlas's branding.
   */
  it('refuses another origin', () => {
    expect(() =>
      articleSchema.parse({ ...valid, ctaLabel: 'Go', ctaHref: 'https://evil.example/x' }),
    ).toThrow();
  });

  /** `//host` is a protocol-relative URL, which a "starts with /" check waves through. */
  it('refuses a protocol-relative URL', () => {
    expect(() =>
      articleSchema.parse({ ...valid, ctaLabel: 'Go', ctaHref: '//evil.example/x' }),
    ).toThrow();
  });

  it('refuses half a button', () => {
    expect(() => articleSchema.parse({ ...valid, ctaLabel: 'Go' })).toThrow();
    expect(() => articleSchema.parse({ ...valid, ctaHref: '/vehicles' })).toThrow();
  });

  it('accepts no button at all', () => {
    expect(() => articleSchema.parse(valid)).not.toThrow();
  });
});

describe('the payload', () => {
  it('defaults to a draft, so nothing is published by accident', () => {
    expect(articleSchema.parse(valid).status).toBe('DRAFT');
  });

  /**
   * The slug is derived from the title and the publication date is stamped by
   * the service. Both are strict rejections rather than silent strips, so a
   * client sending them is told instead of quietly ignored.
   */
  it.each(['slug', 'publishedAt', 'authorId', 'id'])('refuses %s', (field) => {
    expect(() => articleSchema.parse({ ...valid, [field]: 'anything' })).toThrow();
    expect(() => updateArticleSchema.parse({ [field]: 'anything' })).toThrow();
  });

  it('requires something to update', () => {
    expect(() => updateArticleSchema.parse({})).toThrow();
  });

  it('lets an edit clear an optional field', () => {
    expect(updateArticleSchema.parse({ subtitle: null }).subtitle).toBeNull();
  });
});
