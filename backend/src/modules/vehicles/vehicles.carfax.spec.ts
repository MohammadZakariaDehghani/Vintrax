import { VehiclesService } from './vehicles.service';

/**
 * `create`/`update` starting a CARFAX extraction.
 *
 * The badges and timeline are written by `CarfaxExtractWorker`, never by the
 * request itself, so what this layer owns is deciding *when* to ask the
 * worker to run: on a genuinely new or changed link, never on a save that
 * leaves the same report in place — that is the caching the issue asked for,
 * and it is also what stops a dealer's unrelated edit (a price change, a new
 * photo) re-running a fetch that has nothing to do with it.
 */

const REPORT = 'https://vhr.carfax.ca/report/abc';
const OTHER_REPORT = 'https://vhr.carfax.ca/report/xyz';
const SELLER = { id: 'seller-1', email: 'd@example.test', role: 'DEALER' } as never;

function serviceHarness(stored: { carfaxUrl: string | null } = { carfaxUrl: null }) {
  const vehicleWrites: Array<Record<string, unknown>> = [];
  const historyDeletes: Array<Record<string, unknown>> = [];
  const enqueued: Array<{ name: string; jobName: string; payload: unknown }> = [];

  const tx = {
    vehicle: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        vehicleWrites.push(data);
        return {};
      },
    },
    vehicleHistoryEvent: {
      deleteMany: async (args: { where: Record<string, unknown> }) => {
        historyDeletes.push(args.where);
        return { count: 0 };
      },
    },
    vehicleImage: { deleteMany: async () => ({ count: 0 }) },
    vehicleDocument: { deleteMany: async () => ({ count: 0 }) },
  };

  const service = Object.create(VehiclesService.prototype) as VehiclesService;
  Object.assign(service, {
    prisma: {
      vehicle: {
        findUnique: async () => ({
          id: 'v1',
          sellerId: 'seller-1',
          title: 'A car',
          status: 'DRAFT',
          publishedAt: null,
          carfaxUrl: stored.carfaxUrl,
        }),
        create: async ({ data }: { data: Record<string, unknown> }) => {
          vehicleWrites.push(data);
          return { id: 'v1' };
        },
      },
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    },
    queue: {
      enqueue: async (name: string, jobName: string, payload: unknown) => {
        enqueued.push({ name, jobName, payload });
      },
    },
    afterWrite: async () => undefined,
    findById: async () => ({}) as never,
    uniqueSlug: async () => 'a-car-2020',
  });

  return {
    service,
    vehicleWrites,
    historyDeletes,
    enqueued,
  };
}

describe('update, starting a CARFAX extraction', () => {
  it('enqueues a fetch when a new link is added', async () => {
    const { service, enqueued } = serviceHarness({ carfaxUrl: null });
    await service.update('v1', { carfaxUrl: REPORT } as never, SELLER);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      name: 'carfax-extraction',
      jobName: 'extract',
      payload: { vehicleId: 'v1', url: REPORT },
    });
  });

  it('enqueues a fetch when the link changes to a different report', async () => {
    const { service, enqueued } = serviceHarness({ carfaxUrl: REPORT });
    await service.update('v1', { carfaxUrl: OTHER_REPORT } as never, SELLER);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.payload).toEqual({ vehicleId: 'v1', url: OTHER_REPORT });
  });

  it('does not enqueue when the same link is saved again', async () => {
    const { service, enqueued } = serviceHarness({ carfaxUrl: REPORT });
    await service.update('v1', { carfaxUrl: REPORT, city: 'Toronto' } as never, SELLER);

    expect(enqueued).toHaveLength(0);
  });

  it('does not enqueue when the request does not touch the link', async () => {
    const { service, enqueued } = serviceHarness({ carfaxUrl: REPORT });
    await service.update('v1', { city: 'Toronto' } as never, SELLER);

    expect(enqueued).toHaveLength(0);
  });

  it('does not enqueue when the link is cleared', async () => {
    const { service, enqueued } = serviceHarness({ carfaxUrl: REPORT });
    await service.update('v1', { carfaxUrl: '' } as never, SELLER);

    expect(enqueued).toHaveLength(0);
  });
});

describe('update, retiring what the extraction wrote when the link is cleared', () => {
  it('writes the badges and fetch status back to null', async () => {
    const { service, vehicleWrites } = serviceHarness({ carfaxUrl: REPORT });
    await service.update('v1', { carfaxUrl: '' } as never, SELLER);

    expect(vehicleWrites[0]).toEqual({
      carfaxUrl: '',
      carfaxOneOwner: null,
      carfaxLowKilometres: null,
      carfaxFetchedAt: null,
      carfaxFetchError: null,
      showVehicleHistory: false,
    });
  });

  it('deletes the CARFAX-sourced timeline rows, scoped to that source', async () => {
    const { service, historyDeletes } = serviceHarness({ carfaxUrl: REPORT });
    await service.update('v1', { carfaxUrl: '   ' } as never, SELLER);

    expect(historyDeletes).toEqual([{ vehicleId: 'v1', source: 'CARFAX' }]);
  });

  it('leaves the badges alone when the link is untouched', async () => {
    const { service, vehicleWrites, historyDeletes } = serviceHarness({ carfaxUrl: REPORT });
    await service.update('v1', { city: 'Toronto' } as never, SELLER);

    expect(vehicleWrites[0]).toEqual({ city: 'Toronto' });
    expect(historyDeletes).toEqual([]);
  });
});

describe('create, starting a CARFAX extraction', () => {
  it('enqueues a fetch when the new listing carries a report link', async () => {
    const { service, enqueued } = serviceHarness();
    await service.create(
      { year: 2020, make: 'Toyota', model: 'RAV4', carfaxUrl: REPORT, images: [], documents: [] } as never,
      SELLER,
    );

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.payload).toEqual({ vehicleId: 'v1', url: REPORT });
  });

  it('does not enqueue when the new listing has no report link', async () => {
    const { service, enqueued } = serviceHarness();
    await service.create(
      { year: 2020, make: 'Toyota', model: 'RAV4', images: [], documents: [] } as never,
      SELLER,
    );

    expect(enqueued).toHaveLength(0);
  });
});
