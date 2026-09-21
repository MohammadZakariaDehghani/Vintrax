import { CarfaxExtractWorker } from './carfax-extract.worker';
import * as carfaxReport from './carfax-report';

/**
 * The worker's own job: apply an extraction result to the vehicle it was
 * for, without racing an edit that happened while the fetch was running.
 *
 * `fetchCarfaxReport` itself is mocked — it is tested on its own in
 * `carfax-report.spec.ts`, against fixture HTML rather than a live page.
 */

const REPORT = 'https://vhr.carfax.ca/report/abc';

function workerHarness() {
  const vehicleUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> =
    [];
  const historyDeletes: Array<Record<string, unknown>> = [];
  const historyCreates: Array<{ many: boolean; data: unknown }> = [];
  let updateManyResult = 1;

  const tx = {
    vehicleHistoryEvent: {
      deleteMany: async (args: { where: Record<string, unknown> }) => {
        historyDeletes.push(args.where);
        return { count: 0 };
      },
      createMany: async (args: { data: unknown }) => {
        historyCreates.push({ many: true, data: args.data });
        return { count: 0 };
      },
      create: async (args: { data: unknown }) => {
        historyCreates.push({ many: false, data: args.data });
        return {};
      },
    },
  };

  const worker = Object.create(CarfaxExtractWorker.prototype) as CarfaxExtractWorker;
  Object.assign(worker, {
    prisma: {
      vehicle: {
        updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          vehicleUpdates.push(args);
          return { count: updateManyResult };
        },
      },
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    },
    redis: { delByPattern: async () => undefined },
    queue: { registerWorker: () => undefined },
    logger: { debug: () => undefined, warn: () => undefined },
  });

  return {
    worker: worker as unknown as { run: (job: { vehicleId: string; url: string }) => Promise<void> },
    vehicleUpdates,
    historyDeletes,
    historyCreates,
    setStale: () => {
      updateManyResult = 0;
    },
  };
}

describe('CarfaxExtractWorker, on a successful read', () => {
  it('writes the badges and clears any previous error', async () => {
    jest.spyOn(carfaxReport, 'fetchCarfaxReport').mockResolvedValue({
      status: 'ok',
      extraction: { oneOwner: true, lowKilometres: false, records: [], statedAccidentFree: true },
    });

    const { worker, vehicleUpdates } = workerHarness();
    await worker.run({ vehicleId: 'v1', url: REPORT });

    expect(vehicleUpdates).toHaveLength(1);
    expect(vehicleUpdates[0]?.where).toEqual({ id: 'v1', carfaxUrl: REPORT });
    expect(vehicleUpdates[0]?.data).toMatchObject({
      carfaxOneOwner: true,
      carfaxLowKilometres: false,
      carfaxFetchError: null,
    });
    expect(vehicleUpdates[0]?.data.carfaxFetchedAt).toBeInstanceOf(Date);
  });

  it('writes a single NO_ACCIDENTS row when the report states one', async () => {
    jest.spyOn(carfaxReport, 'fetchCarfaxReport').mockResolvedValue({
      status: 'ok',
      extraction: { oneOwner: null, lowKilometres: null, records: [], statedAccidentFree: true },
    });

    const { worker, historyCreates, historyDeletes } = workerHarness();
    await worker.run({ vehicleId: 'v1', url: REPORT });

    expect(historyDeletes).toEqual([{ vehicleId: 'v1', source: 'CARFAX' }]);
    expect(historyCreates).toHaveLength(1);
    expect(historyCreates[0]?.many).toBe(false);
    expect(historyCreates[0]?.data).toMatchObject({ kind: 'NO_ACCIDENTS', source: 'CARFAX' });
  });

  it('writes one ACCIDENT_DAMAGE row per record found', async () => {
    jest.spyOn(carfaxReport, 'fetchCarfaxReport').mockResolvedValue({
      status: 'ok',
      extraction: {
        oneOwner: null,
        lowKilometres: null,
        records: [
          { occurredOn: '2019-03-14', label: 'Accident reported', detail: '$4,200' },
          { occurredOn: null, label: 'Damage reported', detail: null },
        ],
        statedAccidentFree: false,
      },
    });

    const { worker, historyCreates } = workerHarness();
    await worker.run({ vehicleId: 'v1', url: REPORT });

    expect(historyCreates).toHaveLength(1);
    expect(historyCreates[0]?.many).toBe(true);
    expect(historyCreates[0]?.data).toEqual([
      expect.objectContaining({ kind: 'ACCIDENT_DAMAGE', source: 'CARFAX', position: 0 }),
      expect.objectContaining({ kind: 'ACCIDENT_DAMAGE', source: 'CARFAX', position: 1 }),
    ]);
  });

  it('never touches the timeline when nothing was found and nothing was stated', async () => {
    jest.spyOn(carfaxReport, 'fetchCarfaxReport').mockResolvedValue({
      status: 'ok',
      extraction: { oneOwner: true, lowKilometres: null, records: [], statedAccidentFree: false },
    });

    const { worker, historyCreates, historyDeletes } = workerHarness();
    await worker.run({ vehicleId: 'v1', url: REPORT });

    // The vehicle write still runs (badges), but there is nothing to say
    // about the timeline, so its rows are cleared and nothing new is written.
    expect(historyDeletes).toEqual([{ vehicleId: 'v1', source: 'CARFAX' }]);
    expect(historyCreates).toEqual([]);
  });
});

describe('CarfaxExtractWorker, on a failed read', () => {
  it('records the failure reason and leaves the timeline alone', async () => {
    jest
      .spyOn(carfaxReport, 'fetchCarfaxReport')
      .mockResolvedValue({ status: 'unreadable', reason: 'no accident section found' });

    const { worker, vehicleUpdates, historyDeletes, historyCreates } = workerHarness();
    await worker.run({ vehicleId: 'v1', url: REPORT });

    expect(vehicleUpdates[0]?.data).toEqual({
      carfaxFetchedAt: expect.any(Date),
      carfaxFetchError: 'no accident section found',
    });
    expect(historyDeletes).toEqual([]);
    expect(historyCreates).toEqual([]);
  });
});

describe('CarfaxExtractWorker, discarding a stale result', () => {
  it('does not touch the timeline when the link changed while the fetch ran', async () => {
    jest.spyOn(carfaxReport, 'fetchCarfaxReport').mockResolvedValue({
      status: 'ok',
      extraction: { oneOwner: true, lowKilometres: null, records: [], statedAccidentFree: false },
    });

    const { worker, historyDeletes, setStale } = workerHarness();
    setStale();
    await worker.run({ vehicleId: 'v1', url: REPORT });

    expect(historyDeletes).toEqual([]);
  });
});
