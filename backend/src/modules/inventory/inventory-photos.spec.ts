import { InventoryPhotosService, type VehiclePhotoWork } from './inventory-photos.service';
import { fetchRemoteImage } from './remote-image';

/**
 * A large feed can ask for more photos than one import downloads. The cap
 * used to be spent in file order, so the first vehicles got every photo and
 * the rest of the feed listed as "No photo". Every vehicle's main photo now
 * comes first, and the skipped extras are named in the import's errors.
 */

jest.mock('@vintrax/shared', () => ({
  ...jest.requireActual('@vintrax/shared'),
  MAX_PHOTOS_PER_IMPORT: 5,
}));

jest.mock('./remote-image', () => ({
  ...jest.requireActual('./remote-image'),
  fetchRemoteImage: jest.fn(async () => ({
    buffer: Buffer.from('jpeg'),
    contentType: 'image/jpeg',
  })),
}));

function harness() {
  const created: Array<{ vehicleId: string; url: string }> = [];
  const updates: Array<Record<string, unknown>> = [];
  let counter = 0;
  const tx = {
    vehicleImage: {
      deleteMany: jest.fn(),
      createMany: jest.fn(async ({ data }: { data: Array<{ vehicleId: string; url: string }> }) => {
        created.push(...data);
      }),
      update: jest.fn(),
    },
  };
  const prisma = {
    vehicleImage: { findMany: jest.fn().mockResolvedValue([]) },
    vehicle: { findUnique: jest.fn().mockResolvedValue({ sellerId: 'dealer-1' }) },
    inventoryImport: {
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
      }),
    },
    $transaction: jest.fn(async (work: (client: typeof tx) => Promise<void>) => work(tx)),
  };
  const service = new InventoryPhotosService(
    prisma as never,
    { isOwnUrl: () => true, delete: jest.fn() } as never,
    { afterBulkWrite: jest.fn() } as never,
    {
      ingest: jest.fn(async () => {
        counter += 1;
        return { id: `asset-${counter}`, url: `/uploads/vehicles/asset-${counter}/960.webp` };
      }),
      releaseUnused: jest.fn(),
    } as never,
  );
  return { service, created, updates };
}

const photos = (vehicle: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    sourceUrl: `https://photos.example.ca/${vehicle}/${index}.jpg`,
    sourceUpdatedAt: null,
  }));

describe("an import's photo budget", () => {
  beforeEach(() => (fetchRemoteImage as jest.Mock).mockClear());

  it("gives every vehicle its main photo before anyone's extras", async () => {
    const { service, created, updates } = harness();
    // Five-photo cap, four vehicles of four photos each: sixteen asked for.
    const work: VehiclePhotoWork[] = ['a', 'b', 'c', 'd'].map((id) => ({
      vehicleId: id,
      photos: photos(id, 4),
    }));

    await service.run('import-1', work);

    const withPhotos = new Set(created.map((image) => image.vehicleId));
    expect([...withPhotos].sort()).toEqual(['a', 'b', 'c', 'd']);
    // Four main photos and one extra: the cap of five.
    expect(fetchRemoteImage).toHaveBeenCalledTimes(5);

    const final = updates[updates.length - 1]!;
    expect(final.photoStatus).toBe('COMPLETED_WITH_ERRORS');
    expect((final.photoErrors as string[]).join(' ')).toMatch(/11 more photos were not downloaded/);
  });

  it('is expected to cover every main photo even past the cap', () => {
    const work: VehiclePhotoWork[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
      vehicleId: id,
      photos: photos(id, 3),
    }));
    expect(InventoryPhotosService.expectedCount(work)).toBe(6);
  });

  it('downloads everything, and reports no error, when the feed fits', async () => {
    const { service, created, updates } = harness();
    await service.run('import-2', [{ vehicleId: 'a', photos: photos('a', 3) }]);

    expect(created).toHaveLength(3);
    expect(updates[updates.length - 1]!.photoStatus).toBe('COMPLETED');
  });
});
