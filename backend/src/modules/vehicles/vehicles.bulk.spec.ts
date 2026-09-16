import { BadRequestException } from '@nestjs/common';
import {
  MAX_BULK_VEHICLE_IDS,
  bulkListingStatusSchema,
  bulkModerateListingsSchema,
} from '@vintrax/shared';
import { VehiclesService } from './vehicles.service';

/**
 * Applying one decision to many vehicles.
 *
 * The risk a bulk endpoint introduces is not performance, it is a second
 * implementation of the rules: an `updateMany` that publishes twenty listings
 * skips the transition table, the live-auction guard and the paid-order guard
 * that the single-vehicle path enforces. So the behaviour worth pinning is that
 * each id really does go through that path, that one refusal does not take the
 * others down with it, and that every change is still audited by vehicle.
 */

const ACTOR = { id: 'user-1', email: 'dealer@example.test', role: 'DEALER' } as never;

function serviceWith(behaviour: (id: string) => Promise<void>) {
  const audited: Array<{ action: string; entityId: string | null }> = [];
  const calls: string[] = [];

  const service = Object.create(VehiclesService.prototype) as VehiclesService;
  Object.assign(service, {
    prisma: {
      vehicle: {
        findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id, title: `Vehicle ${id}` })),
      },
    },
    audit: {
      record: async (entry: { action: string; entityId: string | null }) => {
        audited.push({ action: entry.action, entityId: entry.entityId });
      },
    },
  });

  const run = async (id: string) => {
    calls.push(id);
    await behaviour(id);
  };
  (service as unknown as { setStatus: typeof run }).setStatus = async (id: string) => run(id);
  (service as unknown as { moderate: typeof run }).moderate = async (id: string) => run(id);

  return { service, audited, calls };
}

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

describe('bulk input', () => {
  it('collapses a repeated id, because selecting is a set operation', () => {
    // The same id twice would otherwise be applied twice and counted twice.
    const parsed = bulkListingStatusSchema.parse({
      ids: [ID_A, ID_A, ID_B],
      status: 'PENDING_REVIEW',
    });

    expect(parsed.ids).toEqual([ID_A, ID_B]);
  });

  it('refuses an empty selection', () => {
    expect(() => bulkListingStatusSchema.parse({ ids: [], status: 'DRAFT' })).toThrow();
  });

  it('caps how many vehicles one request may name', () => {
    const tooMany = Array.from(
      { length: MAX_BULK_VEHICLE_IDS + 1 },
      (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
    );

    expect(() => bulkListingStatusSchema.parse({ ids: tooMany, status: 'DRAFT' })).toThrow();
  });

  it('will not let a seller reach ACTIVE, in bulk any more than singly', () => {
    // The whole point of moderation. A bulk route that widened the accepted
    // statuses would be a way for a dealer to publish their own inventory.
    expect(() => bulkListingStatusSchema.parse({ ids: [ID_A], status: 'ACTIVE' })).toThrow();
    expect(() => bulkListingStatusSchema.parse({ ids: [ID_A], status: 'IN_AUCTION' })).toThrow();
  });

  it('accepts a moderation decision with an optional reason', () => {
    expect(bulkModerateListingsSchema.parse({ ids: [ID_A], approved: true })).toMatchObject({
      approved: true,
    });
    expect(
      bulkModerateListingsSchema.parse({ ids: [ID_A], approved: false, reason: 'Photos unclear' }),
    ).toMatchObject({ reason: 'Photos unclear' });
  });
});

describe('setStatusMany', () => {
  it('applies every id through the single-vehicle path', () => {
    // Not an `updateMany`. That is what keeps the auction and order guards in
    // force for a bulk change.
    const { service, calls } = serviceWith(async () => undefined);

    return service
      .setStatusMany({ ids: [ID_A, ID_B, ID_C], status: 'PENDING_REVIEW' }, ACTOR)
      .then((result) => {
        expect(calls).toEqual([ID_A, ID_B, ID_C]);
        expect(result.succeeded).toBe(3);
        expect(result.failed).toBe(0);
      });
  });

  it('keeps going after a refusal and reports it against its own vehicle', async () => {
    // A dealer selecting the whole page will include something already in
    // review. One refusal must not undo the other two.
    const { service } = serviceWith(async (id) => {
      if (id === ID_B)
        throw new BadRequestException('A PENDING_REVIEW listing can only move to DRAFT.');
    });

    const result = await service.setStatusMany(
      { ids: [ID_A, ID_B, ID_C], status: 'PENDING_REVIEW' },
      ACTOR,
    );

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.outcomes.find((outcome) => outcome.id === ID_B)).toMatchObject({
      ok: false,
      title: `Vehicle ${ID_B}`,
      error: 'A PENDING_REVIEW listing can only move to DRAFT.',
    });
  });

  it('does not relay an error the application did not raise deliberately', async () => {
    // A driver message names columns and constraints, and this string is shown
    // to a dealer.
    const { service } = serviceWith(async () => {
      throw new Error('Invalid `prisma.vehicle.update()` invocation: column "searchVector"');
    });

    const result = await service.setStatusMany({ ids: [ID_A], status: 'DRAFT' }, ACTOR);

    expect(result.outcomes[0]?.error).toBe('Could not be changed.');
    expect(result.outcomes[0]?.error).not.toContain('prisma');
  });

  it('audits each vehicle it changed, and only those', async () => {
    // `@Audit` on the controller reads request.params.id, which a bulk route
    // has none of. Without this the record would say someone did something to
    // nothing.
    const { service, audited } = serviceWith(async (id) => {
      if (id === ID_B) throw new BadRequestException('nope');
    });

    await service.setStatusMany({ ids: [ID_A, ID_B, ID_C], status: 'ARCHIVED' }, ACTOR);

    expect(audited).toEqual([
      { action: 'vehicle.status_changed', entityId: ID_A },
      { action: 'vehicle.status_changed', entityId: ID_C },
    ]);
  });
});

describe('moderateMany', () => {
  it('audits each publication separately', async () => {
    const { service, audited, calls } = serviceWith(async () => undefined);

    const result = await service.moderateMany({ ids: [ID_A, ID_B], approved: true }, ACTOR);

    expect(calls).toEqual([ID_A, ID_B]);
    expect(result.succeeded).toBe(2);
    expect(audited).toEqual([
      { action: 'vehicle.moderated', entityId: ID_A },
      { action: 'vehicle.moderated', entityId: ID_B },
    ]);
  });

  it('reports a rejection per vehicle rather than failing the request', async () => {
    const { service } = serviceWith(async (id) => {
      if (id === ID_A) throw new BadRequestException('Vehicle not found');
    });

    const result = await service.moderateMany({ ids: [ID_A, ID_B], approved: true }, ACTOR);

    expect(result).toMatchObject({ succeeded: 1, failed: 1 });
    expect(result.outcomes[0]).toMatchObject({ ok: false, error: 'Vehicle not found' });
  });
});
