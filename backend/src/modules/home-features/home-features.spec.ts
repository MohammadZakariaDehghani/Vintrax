import { BadRequestException } from '@nestjs/common';
import {
  ROLE_PERMISSIONS,
  createHomeFeatureSchema,
  updateHomeFeatureSchema,
} from '@vintrax/shared';
import { HomeFeaturesService } from './home-features.service';

/** Content saved without media: the library has nothing to resolve. */
const noMedia = { resolve: async () => undefined };

/**
 * Feature blocks are operator content on the home page. Pinned: only an
 * operator writes them, a button goes only to a page here or a website over
 * https, an image has to be one Vintrax issued, and the order is set whole.
 */

describe('who may manage home feature blocks', () => {
  it.each(['BUYER', 'SELLER', 'DEALER', 'INSPECTOR'] as const)('refuses %s', (role) => {
    expect(ROLE_PERMISSIONS[role]).not.toContain('content:manage');
  });
});

describe('a feature block', () => {
  it('needs only a title', () => {
    expect(createHomeFeatureSchema.parse({ title: 'Winter tyre event' }).title).toBe(
      'Winter tyre event',
    );
  });

  it.each([
    ['example.com/offer', 'https://example.com/offer'],
    ['http://example.com', 'https://example.com'],
    ['/vehicles?bodyType=SUV', '/vehicles?bodyType=SUV'],
  ])('saves the button link %s as %s', (typed, saved) => {
    const parsed = createHomeFeatureSchema.parse({
      title: 'Offer',
      buttonLabel: 'See it',
      buttonUrl: typed,
    });
    expect(parsed.buttonUrl).toBe(saved);
  });

  it.each(['javascript:alert(1)', 'mailto:a@b.c', '//evil.example', 'ftp://files.example'])(
    'refuses %s as a button link',
    (buttonUrl) => {
      expect(() =>
        createHomeFeatureSchema.parse({ title: 'Offer', buttonLabel: 'Go', buttonUrl }),
      ).toThrow();
    },
  );

  it('refuses half a button', () => {
    expect(() => createHomeFeatureSchema.parse({ title: 'Offer', buttonLabel: 'Go' })).toThrow();
    expect(() =>
      createHomeFeatureSchema.parse({ title: 'Offer', buttonUrl: 'example.com' }),
    ).toThrow();
  });

  it('only accepts the four button placements', () => {
    expect(() => updateHomeFeatureSchema.parse({ buttonPlacement: 'TOP' })).toThrow();
    expect(updateHomeFeatureSchema.parse({ buttonPlacement: 'ON_IMAGE' }).buttonPlacement).toBe(
      'ON_IMAGE',
    );
  });
});

describe('the feature block service', () => {
  function service(ids: string[] = []) {
    const prisma = {
      homeFeature: {
        findMany: jest.fn().mockResolvedValue(ids.map((id) => ({ id }))),
        update: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _max: { position: null } }),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    return new HomeFeaturesService(
      prisma as never,
      { del: jest.fn(), remember: jest.fn() } as never,
      { isOwnUrl: (url: string) => url.startsWith('/uploads/') } as never,
      noMedia as never,
    );
  }

  it('refuses a photo from another server', async () => {
    await expect(
      service().create({ title: 'Offer', imageUrl: 'https://tracker.example/x.png' }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an order that leaves a block out or repeats one', async () => {
    const features = service([
      'a0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000002',
    ]);
    await expect(
      features.reorder({ ids: ['a0000000-0000-4000-8000-000000000001'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      features.reorder({
        ids: ['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
