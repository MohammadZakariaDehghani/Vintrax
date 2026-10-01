import { saveHomeHeroSchema } from '@vintrax/shared';
import { HomeHeroService } from './home-hero.service';

/** The hero is a draft until switched on, and only then reaches visitors. */

const media = {
  kind: 'IMAGE',
  desktop: {
    assetId: '5f2b4c3e-8f1a-4c55-9d1e-0a6b7c8d9e01',
    url: '/uploads/media/x/960.webp',
    posterUrl: null,
    smallUrl: null,
    width: 1920,
    height: 1080,
    image: null,
  },
  mobile: null,
  alt: null,
  fit: 'COVER',
  position: 'CENTER',
  autoplay: true,
  loop: true,
  animation: { type: 'FADE', durationMs: 700, delayMs: 0, onScroll: true },
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: 'Find your next car',
    subtitle: null,
    primaryCtaLabel: 'Browse inventory',
    primaryCtaUrl: '/vehicles',
    secondaryCtaLabel: null,
    secondaryCtaUrl: null,
    overlayOpacity: 40,
    align: 'LEFT',
    height: 'LARGE',
    media,
    enabled: true,
    updatedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function service(saved: Record<string, unknown> | null) {
  const prisma = {
    homeHero: {
      findUnique: jest.fn().mockResolvedValue(saved),
      upsert: jest.fn(({ create }: { create: Record<string, unknown> }) =>
        Promise.resolve(row({ ...create })),
      ),
    },
  };
  const redis = {
    del: jest.fn(),
    remember: jest.fn((_key: string, _ttl: number, load: () => unknown) => load()),
  };
  const library = { resolve: jest.fn(async (input: unknown) => (input ? media : input)) };
  return {
    prisma,
    redis,
    hero: new HomeHeroService(prisma as never, redis as never, library as never),
  };
}

describe('the home hero', () => {
  it('is not shown before anyone saves one, so the blog leads the page as before', async () => {
    const { hero } = service(null);
    await expect(hero.published()).resolves.toBeNull();
    await expect(hero.current()).resolves.toMatchObject({ enabled: false, media: null });
  });

  it('is not shown while it is a draft', async () => {
    const { hero } = service(row({ enabled: false }));
    await expect(hero.published()).resolves.toBeNull();
  });

  it('is not shown if its stored media cannot be read', async () => {
    const { hero } = service(row({ media: { nonsense: true } }));
    await expect(hero.published()).resolves.toBeNull();
  });

  it('is shown when switched on with media', async () => {
    const { hero } = service(row());
    await expect(hero.published()).resolves.toMatchObject({
      title: 'Find your next car',
      media: { kind: 'IMAGE' },
    });
  });

  it('cannot be switched on without media, nor saved with half a button', () => {
    expect(saveHomeHeroSchema.safeParse({ title: 'Hi', enabled: true }).success).toBe(false);
    expect(saveHomeHeroSchema.safeParse({ title: 'Hi', primaryCtaLabel: 'Browse' }).success).toBe(
      false,
    );
    expect(
      saveHomeHeroSchema.safeParse({
        title: 'Hi',
        primaryCtaLabel: 'Browse',
        primaryCtaUrl: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
  });

  it('drops the cached hero on every save', async () => {
    const { hero, redis } = service(null);
    await hero.save(
      saveHomeHeroSchema.parse({
        title: 'Find your next car',
        enabled: true,
        media: { kind: 'IMAGE', desktop: { assetId: media.desktop.assetId } },
      }),
      'admin',
    );
    expect(redis.del).toHaveBeenCalledWith('site:home-hero');
  });
});
