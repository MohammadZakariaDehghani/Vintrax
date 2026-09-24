import { NotFoundException } from '@nestjs/common';
import {
  ROLE_PERMISSIONS,
  articleQuerySchema,
  articleSchema,
  updateArticleSchema,
} from '@vintrax/shared';
import { ArticlesService } from './articles.service';

/**
 * Editorial posts are operator content on the busiest page of the site.
 *
 * Three rules matter, and all three are the kind that fail silently if nobody
 * pins them: only an operator may write one, the button may not leave Vintrax,
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
  it('accepts a path on Vintrax', () => {
    const parsed = articleSchema.parse({
      ...valid,
      ctaLabel: 'Browse SUVs',
      ctaHref: '/vehicles?bodyType=SUV',
    });

    expect(parsed.ctaHref).toBe('/vehicles?bodyType=SUV');
  });

  /**
   * The largest button on the site pointing at someone else's server is an
   * open redirect wearing Vintrax's branding.
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

describe('pages such as About us', () => {
  it('lets a page go without a photograph', () => {
    const { heroImageUrl: _photo, ...words } = valid;
    expect(articleSchema.parse({ ...words, kind: 'PAGE' }).heroImageUrl).toBeUndefined();
  });

  it('still requires a photograph on a blog post, which fronts the home page banner', () => {
    const { heroImageUrl: _photo, ...words } = valid;
    expect(() => articleSchema.parse(words)).toThrow(/photograph/);
  });

  it('is a blog post unless it says otherwise', () => {
    expect(articleSchema.parse(valid).kind).toBe('POST');
    expect(articleQuerySchema.parse({}).kind).toBe('POST');
  });

  /** A post does not turn into a page, which would take it off the blog without anyone deciding to. */
  it('fixes the kind at creation', () => {
    expect(() => updateArticleSchema.parse({ kind: 'PAGE' })).toThrow();
  });
});

describe('where a page and a post can be read', () => {
  const row = (kind: 'POST' | 'PAGE') => ({
    id: 'a1',
    slug: 'about-us',
    kind,
    title: 'About us',
    subtitle: null,
    body: 'Words.',
    heroImageUrl: null,
    heroAlt: null,
    ctaLabel: null,
    ctaHref: null,
    status: 'PUBLISHED' as const,
    publishedAt: new Date('2026-09-01T00:00:00Z'),
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    author: null,
  });

  function service(kind: 'POST' | 'PAGE') {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      article: {
        findUnique: jest.fn().mockResolvedValue(row(kind)),
        findMany,
        count: jest.fn().mockResolvedValue(0),
      },
    };
    return {
      articles: new ArticlesService(prisma as never, {} as never, {} as never),
      findMany,
    };
  }

  it('serves a page at /pages but not at /blog', async () => {
    const { articles } = service('PAGE');
    await expect(articles.findBySlug('about-us', { kind: 'PAGE' })).resolves.toMatchObject({
      kind: 'PAGE',
    });
    await expect(articles.findBySlug('about-us', { kind: 'POST' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('serves a post at /blog but not at /pages', async () => {
    const { articles } = service('POST');
    await expect(articles.findBySlug('about-us', { kind: 'PAGE' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists only posts on the blog', async () => {
    const { articles, findMany } = service('POST');
    await articles.list(articleQuerySchema.parse({}));
    expect(findMany.mock.calls[0][0].where).toEqual({ kind: 'POST', status: 'PUBLISHED' });
  });
});
