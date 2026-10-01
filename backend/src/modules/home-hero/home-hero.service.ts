import { Injectable } from '@nestjs/common';
import {
  HOME_HERO_OVERLAY,
  parseMediaPresentation,
  type HomeHero,
  type SaveHomeHeroInput,
} from '@vintrax/shared';
import type { HomeHero as HomeHeroRow } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { MediaLibraryService, presentationJson } from '../media/media-library.service';

/** Read on every home page render, written rarely; every write drops the key. */
const CACHE_KEY = 'site:home-hero';
const CACHE_TTL = 600;
const HERO_ID = 1;

/** The hero before anyone has saved one: a draft with the site's own proposition. */
const UNSAVED: HomeHero = {
  title: 'Find your next car',
  subtitle: 'Browse quality vehicles from trusted dealers',
  primaryCtaLabel: 'Browse inventory',
  primaryCtaUrl: '/vehicles',
  secondaryCtaLabel: null,
  secondaryCtaUrl: null,
  overlayOpacity: HOME_HERO_OVERLAY.default,
  align: 'LEFT',
  height: 'LARGE',
  media: null,
  enabled: false,
  updatedAt: null,
};

function toHomeHero(row: HomeHeroRow): HomeHero {
  return {
    title: row.title,
    subtitle: row.subtitle,
    primaryCtaLabel: row.primaryCtaLabel,
    primaryCtaUrl: row.primaryCtaUrl,
    secondaryCtaLabel: row.secondaryCtaLabel,
    secondaryCtaUrl: row.secondaryCtaUrl,
    overlayOpacity: row.overlayOpacity,
    align: row.align,
    height: row.height,
    media: parseMediaPresentation(row.media),
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The home page hero: one row, a draft until an administrator switches it
 * on. While it is off — and on every install until someone does — the
 * newest blog posts head the home page exactly as before.
 */
@Injectable()
export class HomeHeroService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly media: MediaLibraryService,
  ) {}

  /** The saved hero, draft or not, for the editor. */
  async current(): Promise<HomeHero> {
    const row = await this.prisma.homeHero.findUnique({ where: { id: HERO_ID } });
    return row ? toHomeHero(row) : UNSAVED;
  }

  /** What the home page shows: the hero when it is on and has media, otherwise nothing. */
  async published(): Promise<HomeHero | null> {
    return this.redis.remember(CACHE_KEY, CACHE_TTL, async () => {
      const hero = await this.current();
      return hero.enabled && hero.media ? hero : null;
    });
  }

  async save(input: SaveHomeHeroInput, actorId: string): Promise<HomeHero> {
    const media = (await this.media.resolve(input.media)) ?? null;
    const data = {
      title: input.title,
      subtitle: input.subtitle ?? null,
      primaryCtaLabel: input.primaryCtaLabel ?? null,
      primaryCtaUrl: input.primaryCtaUrl ?? null,
      secondaryCtaLabel: input.secondaryCtaLabel ?? null,
      secondaryCtaUrl: input.secondaryCtaUrl ?? null,
      overlayOpacity: input.overlayOpacity,
      align: input.align,
      height: input.height,
      media: presentationJson(media),
      enabled: input.enabled,
      updatedById: actorId,
    };
    const row = await this.prisma.homeHero.upsert({
      where: { id: HERO_ID },
      create: { id: HERO_ID, ...data },
      update: data,
    });
    await this.redis.del(CACHE_KEY);
    return toHomeHero(row);
  }
}
