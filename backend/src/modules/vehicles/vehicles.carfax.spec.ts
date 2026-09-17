import { BadRequestException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';

/**
 * A CARFAX highlight must have a report behind it.
 *
 * The One Owner and Low Kilometres badges carry CARFAX's name and borrow their
 * authority. What makes that defensible is that the badge opens the report the
 * claim came off, so a buyer who doubts it can check. A highlight with no link
 * is that authority with the evidence removed — the same objection that made
 * `carfaxUrl` a validated host rather than any URL — so the service refuses it.
 *
 * It is checked here rather than in the schema because only this layer sees the
 * merged result: `PATCH { carfaxOneOwner: true }` is legitimate when the stored
 * vehicle already has a link, and the request on its own cannot tell.
 */

type Guard = (
  fields: { carfaxUrl?: string; carfaxOneOwner?: boolean; carfaxLowKilometres?: boolean },
  stored: string | null,
) => { hasReport: boolean };

const REPORT = 'https://vhr.carfax.ca/report/abc';

/** The private guard, reached the way the service calls it. */
const guard = (
  VehiclesService.prototype as unknown as { requireReportBehindHighlights: Guard }
).requireReportBehindHighlights.bind(null) as Guard;

describe('requireReportBehindHighlights', () => {
  it('allows a report with no highlights', () => {
    expect(guard({ carfaxUrl: REPORT }, null)).toEqual({ hasReport: true });
  });

  it('allows highlights when this request supplies the report', () => {
    expect(guard({ carfaxUrl: REPORT, carfaxOneOwner: true }, null)).toEqual({ hasReport: true });
  });

  it('allows a highlight on its own when the vehicle already has a report', () => {
    // The case the schema cannot decide: an edit that ticks the box and sends
    // nothing else.
    expect(guard({ carfaxOneOwner: true }, REPORT)).toEqual({ hasReport: true });
  });

  it('refuses a highlight with nothing behind it', () => {
    expect(() => guard({ carfaxOneOwner: true }, null)).toThrow(BadRequestException);
    expect(() => guard({ carfaxLowKilometres: true }, null)).toThrow(BadRequestException);
  });

  it('names the claims it refused, so the message says what to do', () => {
    expect(() => guard({ carfaxOneOwner: true, carfaxLowKilometres: true }, null)).toThrow(
      /One Owner and Low Kilometres/,
    );
  });

  it('treats clearing the link as removing the report', () => {
    // An empty string is how the form clears it. A highlight sent in the same
    // request is refused rather than kept against a link that is going away.
    expect(() => guard({ carfaxUrl: '', carfaxOneOwner: true }, REPORT)).toThrow(
      BadRequestException,
    );
    expect(() => guard({ carfaxUrl: '   ', carfaxOneOwner: true }, REPORT)).toThrow(
      BadRequestException,
    );
  });

  it('reports no report when the link is being cleared, so the flags are retired', () => {
    // `hasReport: false` is what makes `update` write NULL over the stored
    // highlights. Without it a claim outlives its evidence: invisible while
    // there is no link, then back on screen the moment any later edit adds one.
    expect(guard({ carfaxUrl: '' }, REPORT)).toEqual({ hasReport: false });
    expect(guard({}, null)).toEqual({ hasReport: false });
  });

  it('does not refuse a highlight that is being turned off', () => {
    // Unticking the box while clearing the link is a seller tidying up, not a
    // claim. Refusing it would make the two impossible to do in one save.
    expect(guard({ carfaxUrl: '', carfaxOneOwner: false }, REPORT)).toEqual({ hasReport: false });
  });
});

/**
 * The write itself, not just the guard.
 *
 * `hasReport: false` only matters because `update` acts on it. This drives the
 * real method with a stubbed database and reads the row it would have written,
 * because the bug being prevented is invisible at the time it happens: the
 * flags stay true in a column nothing renders, and reappear months later when
 * some unrelated edit adds a link back.
 */
function serviceCapturingUpdate(stored: { carfaxUrl: string | null }) {
  const writes: Array<Record<string, unknown>> = [];

  const service = Object.create(VehiclesService.prototype) as VehiclesService;
  const tx = {
    vehicle: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return {};
      },
    },
  };

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
      },
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    },
    afterWrite: async () => undefined,
    findById: async () => ({}) as never,
  });

  return { service, written: () => writes[0]! };
}

const SELLER = { id: 'seller-1', email: 'd@example.test', role: 'DEALER' } as never;

describe('update, on the CARFAX highlights', () => {
  it('leaves the highlights alone while the report is still there', async () => {
    const { service, written } = serviceCapturingUpdate({ carfaxUrl: REPORT });
    await service.update('v1', { carfaxOneOwner: true } as never, SELLER);

    expect(written()).toEqual({ carfaxOneOwner: true });
  });

  it('retires the highlights when the report link is cleared', async () => {
    // Written as NULL — "not stated" — rather than false, which would record a
    // claim the seller never made.
    const { service, written } = serviceCapturingUpdate({ carfaxUrl: REPORT });
    await service.update('v1', { carfaxUrl: '' } as never, SELLER);

    expect(written()).toEqual({
      carfaxUrl: '',
      carfaxOneOwner: null,
      carfaxLowKilometres: null,
    });
  });

  it('does not resurrect a highlight from an edit that never mentioned one', async () => {
    // A vehicle with no link being edited for something else entirely. The
    // flags are cleared here too, which is what stops a stale tick surviving
    // until a link is added back.
    const { service, written } = serviceCapturingUpdate({ carfaxUrl: null });
    await service.update('v1', { city: 'Toronto' } as never, SELLER);

    expect(written()).toMatchObject({ carfaxOneOwner: null, carfaxLowKilometres: null });
  });
});
