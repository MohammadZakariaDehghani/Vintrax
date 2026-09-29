import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BODY_TYPES,
  isGoogleMapsShortLink,
  type AdminAnalytics,
  type BodyType,
  type BodyTypeImage,
  type BodyTypeImageInput,
  type CreatePartnerInput,
  type AdminSiteSettings,
  type FooterSection,
  type MakeLogo,
  type MakeLogoInput,
  type Partner,
  type ReplaceFooterInput,
  type SiteSettings,
  type SiteSettingsInput,
  type TimeSeriesPoint,
  type UpdatePartnerInput,
} from '@vintrax/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../../common/storage/storage.service';
import { resolveGoogleMapsShortLink } from './google-maps-link';

/** Analytics are expensive and rarely need to be to-the-second fresh. */
const ANALYTICS_CACHE_TTL_SECONDS = 120;

/**
 * Body-type photographs change when an operator changes them, which is close
 * to never, and are read on every home page render. The writes invalidate the
 * key, so the long window costs nothing in freshness.
 */
const BODY_TYPE_IMAGE_CACHE_KEY = 'site:body-type-images';
const BODY_TYPE_IMAGE_CACHE_TTL = 600;

/** Same reasoning as the body-type images: every visitor's first paint reads it, an administrator rarely writes it, and the write invalidates the key. */
const FOOTER_CACHE_KEY = 'site:footer';
const FOOTER_CACHE_TTL = 600;

/** Same reasoning as the footer, which renders these settings on every page. */
const SITE_SETTINGS_CACHE_KEY = 'site:settings';
const SITE_SETTINGS_CACHE_TTL = 600;

/** Same reasoning again: read on every home page render, written close to never. */
const MAKE_LOGO_CACHE_KEY = 'site:make-logos';
const MAKE_LOGO_CACHE_TTL = 600;

/** Same reasoning again: read on every home page render, written close to never. */
const PARTNER_CACHE_KEY = 'site:partners';
const PARTNER_CACHE_TTL = 600;

/** How `Vehicle.make` is compared against a stored logo: trimmed and lowercased, since it is free text a dealer typed rather than a fixed enum. */
function normalizeMake(make: string): string {
  return make.trim().toLowerCase();
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  async analytics(): Promise<AdminAnalytics> {
    return this.redis.remember('admin:analytics', ANALYTICS_CACHE_TTL_SECONDS, async () => {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);

      const [
        totalUsers,
        newUsersThisMonth,
        pendingDealers,
        activeListings,
        listingsPendingReview,
        liveAuctions,
        vehiclesSoldThisMonth,
      ] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
        this.prisma.dealer.count({ where: { status: 'PENDING' } }),
        this.prisma.vehicle.count({ where: { status: { in: ['ACTIVE', 'IN_AUCTION'] } } }),
        this.prisma.vehicle.count({ where: { status: 'PENDING_REVIEW' } }),
        this.prisma.auction.count({ where: { status: 'LIVE' } }),
        this.prisma.vehicle.count({ where: { status: 'SOLD', soldAt: { gte: monthStart } } }),
      ]);

      const [usersSeries, listingsSeries] = await Promise.all([
        this.dailySeries('User', 'createdAt'),
        this.dailySeries('Vehicle', 'publishedAt'),
      ]);

      return {
        totalUsers,
        newUsersThisMonth,
        pendingDealers,
        activeListings,
        listingsPendingReview,
        liveAuctions,
        vehiclesSoldThisMonth,
        usersSeries,
        listingsSeries,
      };
    });
  }

  /**
   * Daily counts over the last 30 days.
   *
   * The table and column are interpolated rather than parameterised, which is
   * only safe because both are chosen from this file's own literals — no
   * caller-supplied value ever reaches here.
   */
  private async dailySeries(
    table: 'User' | 'Vehicle',
    column: 'createdAt' | 'publishedAt',
  ): Promise<TimeSeriesPoint[]> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ day: Date; value: bigint }>>(
      `SELECT date_trunc('day', "${column}") AS day, COUNT(*)::bigint AS value
       FROM "${table}"
       WHERE "${column}" >= NOW() - INTERVAL '30 days'
       GROUP BY day
       ORDER BY day ASC`,
    );
    return rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      value: Number(row.value),
    }));
  }

  /**
   * Every body type, with its photograph if one is set.
   *
   * Returns all nine rather than only the rows that exist, so the admin screen
   * lists the shortcuts a shopper will actually see — including the empty ones,
   * which are the whole reason to open the page.
   */
  async bodyTypeImages(): Promise<BodyTypeImage[]> {
    const rows = await this.prisma.bodyTypeImage.findMany();
    const byType = new Map(rows.map((row) => [row.bodyType, row]));

    return BODY_TYPES.map((bodyType) => {
      const row = byType.get(bodyType);
      return {
        bodyType,
        imageUrl: row?.imageUrl ?? null,
        alt: row?.alt ?? null,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  async setBodyTypeImage(
    bodyType: BodyType,
    input: BodyTypeImageInput,
    actorId: string,
  ): Promise<BodyTypeImage> {
    if (!this.storage.isOwnUrl(input.imageUrl)) {
      throw new BadRequestException(
        'Upload the image through POST /uploads/body-type-images first, then pass the URL it returns. An address on another server is not accepted.',
      );
    }

    const row = await this.prisma.bodyTypeImage.upsert({
      where: { bodyType },
      create: { bodyType, imageUrl: input.imageUrl, alt: input.alt ?? null, updatedById: actorId },
      update: { imageUrl: input.imageUrl, alt: input.alt ?? null, updatedById: actorId },
    });

    await this.redis.del(BODY_TYPE_IMAGE_CACHE_KEY);

    return {
      bodyType: row.bodyType,
      imageUrl: row.imageUrl,
      alt: row.alt,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Drops the row, so the shortcut falls back to an inventory photo. The file
   * itself is left in storage: an operator who removes the wrong picture can
   * re-point at it, and an orphaned image costs bytes rather than correctness.
   */
  async clearBodyTypeImage(bodyType: BodyType): Promise<BodyTypeImage> {
    await this.prisma.bodyTypeImage.deleteMany({ where: { bodyType } });
    await this.redis.del(BODY_TYPE_IMAGE_CACHE_KEY);
    return { bodyType, imageUrl: null, alt: null, updatedAt: null };
  }

  /**
   * The public view, for the home page.
   *
   * Cached because every visitor's first paint reads it and it changes when an
   * administrator saves, which is rarely. Both writes above drop the key, so
   * the change is visible immediately rather than at the end of the window.
   */
  async publicBodyTypeImages(): Promise<BodyTypeImage[]> {
    return this.redis.remember(BODY_TYPE_IMAGE_CACHE_KEY, BODY_TYPE_IMAGE_CACHE_TTL, () =>
      this.bodyTypeImages(),
    );
  }

  /** Every footer section, in order, each with its links in order. */
  async footer(): Promise<FooterSection[]> {
    const rows = await this.prisma.footerSection.findMany({
      orderBy: { position: 'asc' },
      include: { links: { orderBy: { position: 'asc' } } },
    });

    return rows.map((section) => ({
      id: section.id,
      title: section.title,
      position: section.position,
      column: section.column,
      links: section.links.map((link) => ({
        id: link.id,
        label: link.label,
        href: link.href,
        icon: link.icon,
        imageUrl: link.imageUrl,
        position: link.position,
      })),
    }));
  }

  /**
   * The public view, for the site-wide footer.
   *
   * Cached the same way the body-type photographs are: every page render reads
   * it, an administrator saving it is rare, and the write below drops the key
   * so a change is visible on the next request rather than at the end of the
   * window.
   */
  async publicFooter(): Promise<FooterSection[]> {
    return this.redis.remember(FOOTER_CACHE_KEY, FOOTER_CACHE_TTL, () => this.footer());
  }

  /**
   * Replaces the whole footer, matching how a vehicle's history timeline is
   * saved: the caller holds the ordered list and the previous rows are
   * dropped rather than diffed against it, so there is exactly one way a
   * section or link stops existing — it is missing from the next save.
   *
   * Transactional so a page load between the delete and the insert never sees
   * an empty footer; `onDelete: Cascade` on `FooterLink` means dropping a
   * section takes its links with it without a separate statement.
   */
  async replaceFooter(input: ReplaceFooterInput, actorId: string): Promise<FooterSection[]> {
    for (const section of input.sections) {
      for (const link of section.links) {
        if (link.imageUrl) this.requireOwnImage(link.imageUrl, '/uploads/footer-icons');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.footerSection.deleteMany();

      for (const [sectionIndex, section] of input.sections.entries()) {
        await tx.footerSection.create({
          data: {
            title: section.title,
            position: sectionIndex,
            column: section.column,
            updatedById: actorId,
            links: {
              create: section.links.map((link, linkIndex) => ({
                label: link.label,
                href: link.href,
                icon: link.icon ?? null,
                imageUrl: link.imageUrl ?? null,
                position: linkIndex,
              })),
            },
          },
        });
      }
    });

    await this.redis.del(FOOTER_CACHE_KEY);
    return this.footer();
  }

  /**
   * The footer's copyright lines and the Contact page's content, including
   * where Contact-form messages go. The row is created by the migration that
   * introduced it; an empty default stands in if it has been removed.
   */
  async siteSettings(): Promise<AdminSiteSettings> {
    const row = await this.prisma.siteSettings.findUnique({ where: { id: 1 } });
    return {
      footerCopyright: row?.footerCopyright ?? '',
      footerNote: row?.footerNote ?? null,
      contactIntro: row?.contactIntro ?? null,
      contactAddress: row?.contactAddress ?? null,
      contactPhone: row?.contactPhone ?? null,
      contactEmail: row?.contactEmail ?? null,
      contactHours: row?.contactHours ?? null,
      contactMapImageUrl: row?.contactMapImageUrl ?? null,
      contactMapUrl: row?.contactMapUrl ?? null,
      contactRecipient: row?.contactRecipient ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  /** The public view: everything but the address messages are sent to. */
  async publicSiteSettings(): Promise<SiteSettings> {
    return this.redis.remember(SITE_SETTINGS_CACHE_KEY, SITE_SETTINGS_CACHE_TTL, async () => {
      const { contactRecipient: _recipient, ...settings } = await this.siteSettings();
      return settings;
    });
  }

  async updateSiteSettings(input: SiteSettingsInput, actorId: string): Promise<AdminSiteSettings> {
    if (input.contactMapImageUrl) {
      this.requireOwnImage(input.contactMapImageUrl, '/uploads/site-images');
    }
    // A share link says nothing about the place until it is followed; the
    // full link it leads to is what is kept.
    const contactMapUrl =
      input.contactMapUrl && isGoogleMapsShortLink(input.contactMapUrl)
        ? await resolveGoogleMapsShortLink(input.contactMapUrl)
        : input.contactMapUrl;
    const data = { ...input, contactMapUrl, updatedById: actorId };
    await this.prisma.siteSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });
    await this.redis.del(SITE_SETTINGS_CACHE_KEY);
    return this.siteSettings();
  }

  /**
   * An operator-supplied image has to be one Vintrax issued — the same rule as
   * the make logos and partner logos, for the same reason: it loads on every
   * visitor's page.
   */
  private requireOwnImage(url: string, uploadRoute: string): void {
    if (!this.storage.isOwnUrl(url)) {
      throw new BadRequestException(
        `Upload the image through POST ${uploadRoute} first, then pass the URL it returns. An address on another server is not accepted.`,
      );
    }
  }

  /**
   * Every make an administrator has set a logo for.
   *
   * Unlike `bodyTypeImages`, this does not map over a fixed enum first — there
   * is no closed set of makes to backfill — so it returns exactly the rows
   * that exist, sorted for a stable admin screen rather than by relevance.
   */
  async makeLogos(): Promise<MakeLogo[]> {
    const rows = await this.prisma.makeLogo.findMany({ orderBy: { make: 'asc' } });
    return rows.map((row) => ({
      make: row.make,
      imageUrl: row.imageUrl,
      alt: row.alt,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async setMakeLogo(make: string, input: MakeLogoInput, actorId: string): Promise<MakeLogo> {
    if (!this.storage.isOwnUrl(input.imageUrl)) {
      throw new BadRequestException(
        'Upload the image through POST /uploads/make-logos first, then pass the URL it returns. An address on another server is not accepted.',
      );
    }

    const key = normalizeMake(make);
    if (key.length === 0) {
      throw new BadRequestException('Make cannot be empty.');
    }

    const row = await this.prisma.makeLogo.upsert({
      where: { make: key },
      create: { make: key, imageUrl: input.imageUrl, alt: input.alt ?? null, updatedById: actorId },
      update: { imageUrl: input.imageUrl, alt: input.alt ?? null, updatedById: actorId },
    });

    await this.redis.del(MAKE_LOGO_CACHE_KEY);

    return {
      make: row.make,
      imageUrl: row.imageUrl,
      alt: row.alt,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Drops the row, so the popular-makes row falls back to its generated mark
   * for that make. The file itself is left in storage, the same reasoning as
   * clearing a body-type photo: an operator who removes the wrong logo can
   * re-point at it, and an orphaned image costs bytes rather than correctness.
   */
  async clearMakeLogo(make: string): Promise<void> {
    await this.prisma.makeLogo.deleteMany({ where: { make: normalizeMake(make) } });
    await this.redis.del(MAKE_LOGO_CACHE_KEY);
  }

  /**
   * The public view, for the home page's popular-makes row. Cached the same
   * way the body-type photographs are.
   */
  async publicMakeLogos(): Promise<MakeLogo[]> {
    return this.redis.remember(MAKE_LOGO_CACHE_KEY, MAKE_LOGO_CACHE_TTL, () => this.makeLogos());
  }

  /**
   * Every partner, enabled or not. Read through `publicPartners`'s cache by
   * every caller, admin page and home page alike — same shape as
   * `makeLogos`/`publicMakeLogos`. Filtering to `enabled` for display is the
   * caller's job: the admin page needs both to manage them, and the home
   * page filters this same list down to what it draws.
   */
  async partners(): Promise<Partner[]> {
    const rows = await this.prisma.partner.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toPartner);
  }

  async createPartner(input: CreatePartnerInput, actorId: string): Promise<Partner> {
    if (!this.storage.isOwnUrl(input.logoUrl)) {
      throw new BadRequestException(
        'Upload the image through POST /uploads/partners first, then pass the URL it returns. An address on another server is not accepted.',
      );
    }

    const row = await this.prisma.partner.create({
      data: {
        name: input.name,
        logoUrl: input.logoUrl,
        alt: input.alt ?? null,
        updatedById: actorId,
      },
    });

    await this.redis.del(PARTNER_CACHE_KEY);
    return toPartner(row);
  }

  async updatePartner(id: string, input: UpdatePartnerInput, actorId: string): Promise<Partner> {
    if (input.logoUrl !== undefined && !this.storage.isOwnUrl(input.logoUrl)) {
      throw new BadRequestException(
        'Upload the image through POST /uploads/partners first, then pass the URL it returns. An address on another server is not accepted.',
      );
    }

    const existing = await this.prisma.partner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Partner not found');

    const row = await this.prisma.partner.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
        ...(input.alt !== undefined ? { alt: input.alt } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedById: actorId,
      },
    });

    await this.redis.del(PARTNER_CACHE_KEY);
    return toPartner(row);
  }

  /**
   * Deletes the row outright, unlike `clearMakeLogo`'s soft "no row means no
   * logo": a partner has no fallback state to revert to, so removing it here
   * is removing it — `enabled` is the reversible action, this is not.
   */
  async deletePartner(id: string): Promise<void> {
    await this.prisma.partner.deleteMany({ where: { id } });
    await this.redis.del(PARTNER_CACHE_KEY);
  }

  /**
   * The cached read both the admin page and the home page use — same shape
   * as `publicMakeLogos`. Unfiltered, same as `partners()`: a disabled
   * partner is not sensitive, only unwanted on the home page, and it is the
   * home page's own carousel that filters to `enabled` before rendering.
   */
  async publicPartners(): Promise<Partner[]> {
    return this.redis.remember(PARTNER_CACHE_KEY, PARTNER_CACHE_TTL, () => this.partners());
  }
}

function toPartner(row: {
  id: string;
  name: string;
  logoUrl: string;
  alt: string | null;
  enabled: boolean;
  updatedAt: Date;
}): Partner {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logoUrl,
    alt: row.alt,
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}
