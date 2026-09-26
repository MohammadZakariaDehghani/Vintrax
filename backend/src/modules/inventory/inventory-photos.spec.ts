import {
  InventoryPhotosService,
  PHOTO_RUN_DEADLINE_MS,
  PHOTO_RUN_STALE_MS,
  STALE_RUN_MESSAGE,
  TIMED_OUT_MESSAGE,
  type VehiclePhotoWork,
} from './inventory-photos.service';
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
    // One import row, with a status the conditional writes check the way
    // the database would: a write that requires RUNNING finds nothing once
    // something else has marked the run finished.
    inventoryImport: {
      status: 'PENDING' as string,
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        if (typeof data.photoStatus === 'string') prisma.inventoryImport.status = data.photoStatus;
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { photoStatus?: string | { in: string[] } };
          data: Record<string, unknown>;
        }) => {
          const wanted = where.photoStatus;
          const matches =
            wanted === undefined ||
            (typeof wanted === 'string'
              ? wanted === prisma.inventoryImport.status
              : wanted.in.includes(prisma.inventoryImport.status));
          if (!matches) return { count: 0 };
          updates.push(data);
          if (typeof data.photoStatus === 'string')
            prisma.inventoryImport.status = data.photoStatus;
          return { count: 1 };
        },
      ),
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
  return { service, created, updates, prisma };
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

describe('a photo run that stops', () => {
  beforeEach(() => (fetchRemoteImage as jest.Mock).mockClear());
  afterEach(() => jest.useRealTimers());

  it('writes a heartbeat as it goes', async () => {
    const { service, updates } = harness();
    await service.run('import-3', [
      { vehicleId: 'a', photos: photos('a', 2) },
      { vehicleId: 'b', photos: photos('b', 2) },
    ]);
    expect(updates.filter((update) => update.photosHeartbeatAt instanceof Date).length).toBe(
      updates.length,
    );
  });

  it('ends quietly, without overwriting the status, once the sweep has marked it stopped', async () => {
    const { service, prisma, updates, created } = harness();
    // The sweep calls it dead while the first vehicle is downloading.
    (fetchRemoteImage as jest.Mock).mockImplementationOnce(async () => {
      prisma.inventoryImport.status = 'FAILED';
      return { buffer: Buffer.from('jpeg'), contentType: 'image/jpeg' };
    });

    await service.run('import-4', [
      { vehicleId: 'a', photos: photos('a', 1) },
      { vehicleId: 'b', photos: photos('b', 1) },
    ]);

    expect(prisma.inventoryImport.status).toBe('FAILED');
    expect(updates.some((update) => update.photoStatus === 'COMPLETED')).toBe(false);
    // Nothing downloaded for the second vehicle once the run was stopped.
    expect(fetchRemoteImage).toHaveBeenCalledTimes(1);
    expect(created.map((image) => image.vehicleId)).toEqual(['a']);
  });

  it('stops itself, and says why, once it runs past its time limit', async () => {
    const { service, prisma, updates } = harness();
    const start = Date.now();
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(start);
    (fetchRemoteImage as jest.Mock).mockImplementationOnce(async () => {
      now.mockReturnValue(start + PHOTO_RUN_DEADLINE_MS + 1);
      return { buffer: Buffer.from('jpeg'), contentType: 'image/jpeg' };
    });

    await service.run('import-5', [
      { vehicleId: 'a', photos: photos('a', 1) },
      { vehicleId: 'b', photos: photos('b', 1) },
    ]);
    now.mockRestore();

    expect(prisma.inventoryImport.status).toBe('FAILED');
    const final = updates[updates.length - 1]!;
    expect(final.photoErrors).toContain(TIMED_OUT_MESSAGE);
    expect(fetchRemoteImage).toHaveBeenCalledTimes(1);
  });
});

describe('the stale photo run sweep', () => {
  it('fails PENDING and RUNNING runs whose heartbeat has gone quiet, and older runs without one', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const service = new InventoryPhotosService(
      { inventoryImport: { updateMany } } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const before = Date.now();
    expect(await service.failStaleRuns({ sellerId: 'dealer-1' })).toBe(2);

    const { where, data } = updateMany.mock.calls[0]![0];
    expect(where.sellerId).toBe('dealer-1');
    expect(where.photoStatus).toEqual({ in: ['PENDING', 'RUNNING'] });
    const cutoff = where.OR[0].photosHeartbeatAt.lt as Date;
    expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(PHOTO_RUN_STALE_MS - 1000);
    expect(where.OR[1]).toEqual({ photosHeartbeatAt: null, createdAt: { lt: cutoff } });
    expect(data).toMatchObject({
      photoStatus: 'FAILED',
      photoErrors: { push: STALE_RUN_MESSAGE },
    });
  });

  it('never throws', async () => {
    const service = new InventoryPhotosService(
      { inventoryImport: { updateMany: jest.fn().mockRejectedValue(new Error('down')) } } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.failStaleRuns()).resolves.toBe(0);
  });
});
