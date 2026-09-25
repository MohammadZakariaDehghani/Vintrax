import { BadRequestException, NotFoundException } from '@nestjs/common';
import { savePromoTileSchema } from '@vintrax/shared';
import { PromoTilesService } from './promo-tiles.service';

/**
 * Promo tiles are operator content on the home page. Pinned: exactly three
 * slots, a link only to a page here or a website over https, an image Vintrax
 * issued, and a size from the fixed choices.
 */

const valid = {
  imageUrl: '/uploads/promo-tiles/a.webp',
  linkUrl: '/vehicles?bodyType=SUV',
  widthSpan: 4,
  heightPx: 220,
  enabled: true,
};

describe('a promo tile', () => {
  it.each([
    ['example.com/offer', 'https://example.com/offer'],
    ['/dealers', '/dealers'],
  ])('saves the link %s as %s', (typed, saved) => {
    expect(savePromoTileSchema.parse({ ...valid, linkUrl: typed }).linkUrl).toBe(saved);
  });

  it.each(['javascript:alert(1)', '//evil.example', 'mailto:a@b.c'])(
    'refuses %s as a link',
    (linkUrl) => {
      expect(() => savePromoTileSchema.parse({ ...valid, linkUrl })).toThrow();
    },
  );

  it('only accepts the offered widths and a height in range', () => {
    expect(() => savePromoTileSchema.parse({ ...valid, widthSpan: 5 })).toThrow();
    expect(() => savePromoTileSchema.parse({ ...valid, heightPx: 20 })).toThrow();
    expect(() => savePromoTileSchema.parse({ ...valid, heightPx: 2000 })).toThrow();
    expect(savePromoTileSchema.parse({ ...valid, widthSpan: 12 }).widthSpan).toBe(12);
  });
});

describe('the promo tile service', () => {
  function service(rows: Array<Record<string, unknown>> = []) {
    const prisma = {
      promoTile: {
        findMany: jest.fn().mockResolvedValue(rows),
        upsert: jest.fn().mockImplementation(({ create }) => ({
          ...create,
          id: 'x',
          updatedAt: new Date('2026-09-25T00:00:00Z'),
        })),
      },
    };
    const redis = {
      del: jest.fn(),
      remember: jest.fn((_key: string, _ttl: number, load: () => unknown) => load()),
    };
    return {
      prisma,
      tiles: new PromoTilesService(
        prisma as never,
        redis as never,
        { isOwnUrl: (url: string) => url.startsWith('/uploads/') } as never,
      ),
    };
  }

  it('always lists three slots, filling the unsaved ones', async () => {
    const { tiles } = service([
      { ...valid, slot: 2, imageAlt: null, updatedAt: new Date('2026-09-25T00:00:00Z') },
    ]);
    const all = await tiles.all();
    expect(all.map((tile) => tile.slot)).toEqual([1, 2, 3]);
    expect(all[0]?.imageUrl).toBeNull();
    expect(all[1]?.imageUrl).toBe(valid.imageUrl);
  });

  it('publishes only switched-on tiles with a picture', async () => {
    const { tiles } = service([
      { ...valid, slot: 1, imageAlt: null, updatedAt: new Date() },
      { ...valid, slot: 2, enabled: false, imageAlt: null, updatedAt: new Date() },
    ]);
    expect((await tiles.published()).map((tile) => tile.slot)).toEqual([1]);
  });

  it('refuses a slot outside 1 to 3', async () => {
    const { tiles } = service();
    await expect(tiles.save(4, valid as never, 'admin')).rejects.toBeInstanceOf(NotFoundException);
    await expect(tiles.save(0, valid as never, 'admin')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a photo from another server', async () => {
    const { tiles } = service();
    await expect(
      tiles.save(1, { ...valid, imageUrl: 'https://tracker.example/x.png' } as never, 'admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('saves a slot by upserting it', async () => {
    const { tiles, prisma } = service();
    const saved = await tiles.save(3, savePromoTileSchema.parse(valid), 'admin');
    expect(saved.slot).toBe(3);
    expect(prisma.promoTile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slot: 3 } }),
    );
  });
});
