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

  describe('as a video', () => {
    const video = {
      ...valid,
      mediaType: 'VIDEO',
      videoUrl: '/uploads/promo-tiles/v.mp4',
      videoPosterUrl: '/uploads/promo-tiles/v.webp',
    };
    const row = (fields: Record<string, unknown>) => ({
      imageAlt: null,
      updatedAt: new Date(),
      ...fields,
    });

    it('keeps the layout it had as an image: width, height and slot are the same fields', async () => {
      const { tiles, prisma } = service();
      await tiles.save(
        2,
        savePromoTileSchema.parse({ ...video, widthSpan: 8, heightPx: 400 }),
        'admin',
      );
      const { create } = prisma.promoTile.upsert.mock.calls[0]![0];
      expect(create).toMatchObject({
        slot: 2,
        widthSpan: 8,
        heightPx: 400,
        mediaType: 'VIDEO',
        videoUrl: video.videoUrl,
        videoPosterUrl: video.videoPosterUrl,
        // The photo is kept, as the fallback and for switching back.
        imageUrl: valid.imageUrl,
      });
    });

    it('needs a video before it can be a video tile', () => {
      expect(() =>
        savePromoTileSchema.parse({ ...valid, mediaType: 'VIDEO', videoUrl: null }),
      ).toThrow(/Upload a video/);
    });

    it('refuses a video or poster from another server', async () => {
      const { tiles } = service();
      await expect(
        tiles.save(1, { ...video, videoUrl: 'https://cdn.example/a.mp4' } as never, 'admin'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        tiles.save(1, { ...video, videoPosterUrl: 'https://cdn.example/a.jpg' } as never, 'admin'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('publishes a video tile without a photo, and not a video tile without a video', async () => {
      const { tiles } = service([
        row({ ...video, slot: 1, imageUrl: null }),
        row({ ...video, slot: 2, videoUrl: null }),
        row({ ...valid, slot: 3, mediaType: 'IMAGE' }),
      ]);
      expect((await tiles.published()).map((tile) => tile.slot)).toEqual([1, 3]);
    });

    it('leaves the media type alone when a save does not mention it', async () => {
      const { tiles, prisma } = service();
      await tiles.save(1, savePromoTileSchema.parse(valid), 'admin');
      const { update } = prisma.promoTile.upsert.mock.calls[0]![0];
      expect(update).not.toHaveProperty('mediaType');
      expect(update).not.toHaveProperty('videoUrl');
    });

    it('switches back to an image without losing the video', async () => {
      const { tiles, prisma } = service();
      await tiles.save(1, savePromoTileSchema.parse({ ...video, mediaType: 'IMAGE' }), 'admin');
      const { update } = prisma.promoTile.upsert.mock.calls[0]![0];
      expect(update).toMatchObject({ mediaType: 'IMAGE', videoUrl: video.videoUrl });
    });
  });
});
