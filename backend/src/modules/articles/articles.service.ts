import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  Article,
  ArticleInput,
  ArticleQuery,
  ArticleSummary,
  Paginated,
  UpdateArticleInput,
} from '@vintrax/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../../common/storage/storage.service';

const articleSelect = {
  id: true,
  slug: true,
  title: true,
  subtitle: true,
  body: true,
  heroImageUrl: true,
  heroAlt: true,
  ctaLabel: true,
  ctaHref: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ArticleSelect;

type ArticleRow = Prisma.ArticleGetPayload<{ select: typeof articleSelect }>;

/**
 * The masthead is on every home page render and changes when someone publishes,
 * which is rare. Every write drops the key, so the window costs nothing.
 */
const MASTHEAD_CACHE_KEY = 'content:masthead';
const MASTHEAD_CACHE_TTL = 300;

/** Slugs the routing already uses, so a post can never take one. */
const RESERVED_SLUGS = new Set(['new', 'masthead', 'admin']);

@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  /**
   * The post the home page leads with: the most recently published one.
   *
   * Null when nothing is published, and the caller keeps its own hero. A front
   * page that depends on an editor having written something would be blank on
   * a fresh install.
   */
  async masthead(): Promise<ArticleSummary | null> {
    return this.redis.remember(MASTHEAD_CACHE_KEY, MASTHEAD_CACHE_TTL, async () => {
      const row = await this.prisma.article.findFirst({
        where: { status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
        select: articleSelect,
      });
      return row ? this.toSummary(row) : null;
    });
  }

  /**
   * Lists posts.
   *
   * `includeUnpublished` is the caller's assertion that it checked a
   * permission — the controller sets it only on the admin route. Without it the
   * status filter is pinned to PUBLISHED rather than merely defaulted, so a
   * visitor passing `?status=DRAFT` reads nothing rather than reading drafts.
   */
  async list(
    query: ArticleQuery,
    { includeUnpublished = false } = {},
  ): Promise<Paginated<ArticleSummary>> {
    const where: Prisma.ArticleWhereInput = includeUnpublished
      ? query.status
        ? { status: query.status }
        : {}
      : { status: 'PUBLISHED' };

    const [total, rows] = await Promise.all([
      this.prisma.article.count({ where }),
      this.prisma.article.findMany({
        where,
        select: articleSelect,
        orderBy: includeUnpublished
          ? { updatedAt: 'desc' }
          : [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => this.toSummary(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findBySlug(slug: string, { includeUnpublished = false } = {}): Promise<Article> {
    const row = await this.prisma.article.findUnique({ where: { slug }, select: articleSelect });
    // An unpublished post is "not found" rather than "forbidden": whether a
    // draft exists at a given slug is not a visitor's business either.
    if (!row || (!includeUnpublished && row.status !== 'PUBLISHED')) {
      throw new NotFoundException('Article not found');
    }
    return this.toDetail(row);
  }

  async create(input: ArticleInput, authorId: string): Promise<Article> {
    this.requireOwnImage(input.heroImageUrl);

    const row = await this.prisma.article.create({
      data: {
        slug: await this.uniqueSlug(input.title),
        title: input.title,
        subtitle: input.subtitle ?? null,
        body: input.body,
        heroImageUrl: input.heroImageUrl,
        heroAlt: input.heroAlt ?? null,
        ctaLabel: input.ctaLabel ?? null,
        ctaHref: input.ctaHref ?? null,
        status: input.status,
        publishedAt: input.status === 'PUBLISHED' ? new Date() : null,
        authorId,
      },
      select: articleSelect,
    });

    await this.redis.del(MASTHEAD_CACHE_KEY);
    return this.toDetail(row);
  }

  async update(id: string, input: UpdateArticleInput): Promise<Article> {
    const existing = await this.prisma.article.findUnique({
      where: { id },
      select: { id: true, status: true, publishedAt: true },
    });
    if (!existing) throw new NotFoundException('Article not found');
    if (input.heroImageUrl) this.requireOwnImage(input.heroImageUrl);

    // The first publication stamps the date; later edits leave it alone, so
    // fixing a typo does not reorder the site.
    const becomingPublished = input.status === 'PUBLISHED' && !existing.publishedAt;

    const row = await this.prisma.article.update({
      where: { id },
      data: {
        ...input,
        ...(becomingPublished ? { publishedAt: new Date() } : {}),
      },
      select: articleSelect,
    });

    await this.redis.del(MASTHEAD_CACHE_KEY);
    return this.toDetail(row);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.article.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Article not found');

    await this.prisma.article.delete({ where: { id } });
    await this.redis.del(MASTHEAD_CACHE_KEY);
  }

  /**
   * The hero has to be an image Vintrax issued.
   *
   * The same rule as the body-type photographs, for the same reason: this
   * picture loads on the front page for every visitor, and an address on
   * someone else's server is a referer leak and an outage Vintrax cannot fix.
   */
  private requireOwnImage(url: string): void {
    if (!this.storage.isOwnUrl(url)) {
      throw new BadRequestException(
        'Upload the image through POST /uploads/article-images first, then pass the URL it returns. An address on another server is not accepted.',
      );
    }
  }

  /**
   * A readable, stable slug. Collisions get a numeric suffix rather than a
   * random one, so a second "Winter tyres" post reads `winter-tyres-2`.
   */
  private async uniqueSlug(title: string): Promise<string> {
    const cleaned =
      title
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'post';

    // A post titled "New" would take the slug the admin editor uses for its
    // own create screen, and the post would be permanently unreachable there.
    // Cheaper to sidestep than to explain.
    const base = RESERVED_SLUGS.has(cleaned) ? `${cleaned}-post` : cleaned;

    for (let suffix = 0; suffix < 50; suffix += 1) {
      const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
      const taken = await this.prisma.article.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return `${base}-${Date.now()}`;
  }

  private toSummary(row: ArticleRow): ArticleSummary {
    const { body: _body, ...summary } = this.toDetail(row);
    return summary;
  }

  private toDetail(row: ArticleRow): Article {
    const author = row.author ? `${row.author.firstName} ${row.author.lastName}`.trim() : null;
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      body: row.body,
      heroImageUrl: row.heroImageUrl,
      heroAlt: row.heroAlt,
      ctaLabel: row.ctaLabel,
      ctaHref: row.ctaHref,
      status: row.status,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      authorName: author || null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
