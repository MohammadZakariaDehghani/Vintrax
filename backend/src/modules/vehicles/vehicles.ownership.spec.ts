import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';

/**
 * The dealer portal's create, edit and delete are the `/vehicles` routes, so
 * multi-tenancy for them lives here: a dealer reaches their own vehicles, and
 * another dealer's vehicle is refused before anything is written.
 */

const DEALER_A = { id: 'dealer-a', email: 'a@example.test', role: 'DEALER' } as never;
const DEALER_B = { id: 'dealer-b', email: 'b@example.test', role: 'DEALER' } as never;

interface Row {
  id: string;
  sellerId: string;
  title: string;
  status: string;
  publishedAt: Date | null;
  priceCad: number;
}

function harness() {
  const rows = new Map<string, Row>([
    [
      'car-a',
      {
        id: 'car-a',
        sellerId: 'dealer-a',
        title: 'A car',
        status: 'DRAFT',
        publishedAt: null,
        priceCad: 1000,
      },
    ],
    [
      'car-b',
      {
        id: 'car-b',
        sellerId: 'dealer-b',
        title: 'B car',
        status: 'DRAFT',
        publishedAt: null,
        priceCad: 2000,
      },
    ],
  ]);
  const writes: string[] = [];
  let created: Record<string, unknown> | null = null;

  const vehicle = {
    findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      writes.push(`update:${where.id}`);
      rows.set(where.id, { ...rows.get(where.id)!, ...data });
    },
    delete: async ({ where }: { where: { id: string } }) => {
      writes.push(`delete:${where.id}`);
      rows.delete(where.id);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      created = data;
      return { id: 'new-car' };
    },
  };

  const prisma = {
    vehicle,
    auction: { findFirst: async () => null },
    vehicleImage: { findMany: async () => [] },
    $transaction: async (run: (tx: unknown) => Promise<void>) => run({ vehicle }),
  };

  const service = Object.create(VehiclesService.prototype) as VehiclesService;
  Object.assign(service, {
    prisma,
    audit: { record: async () => undefined },
    vehicleImages: {
      assetIdsFor: async () => new Map(),
      releaseUnused: async () => 0,
    },
    logger: { warn: () => undefined },
    afterWrite: async () => undefined,
    findById: async (id: string) => ({ id }),
    uniqueSlug: async () => 'a-slug',
    titlesFor: async (ids: string[]) => new Map(ids.map((id) => [id, rows.get(id)?.title ?? id])),
  });

  return { service, rows, writes, created: () => created };
}

describe('vehicle ownership', () => {
  it('creates a vehicle owned by the caller, whatever the request says', async () => {
    const { service, created } = harness();
    await service.create({ images: [], documents: [], sellerId: 'dealer-b' } as never, DEALER_A);
    expect(created()).toMatchObject({ sellerId: 'dealer-a', publishedAt: null });
  });

  it('lets a dealer edit their own vehicle', async () => {
    const { service, rows } = harness();
    await service.update('car-a', { priceCad: 1500 } as never, DEALER_A);
    expect(rows.get('car-a')?.priceCad).toBe(1500);
  });

  it("refuses to edit another dealer's vehicle, before writing anything", async () => {
    const { service, rows, writes } = harness();
    await expect(
      service.update('car-b', { priceCad: 1 } as never, DEALER_A),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rows.get('car-b')?.priceCad).toBe(2000);
    expect(writes).toEqual([]);
  });

  it('lets a dealer delete their own vehicle', async () => {
    const { service, rows } = harness();
    await service.remove('car-a', DEALER_A);
    expect(rows.has('car-a')).toBe(false);
  });

  it("refuses to delete another dealer's vehicle", async () => {
    const { service, rows } = harness();
    await expect(service.remove('car-b', DEALER_A)).rejects.toBeInstanceOf(ForbiddenException);
    expect(rows.has('car-b')).toBe(true);
  });

  it('reports an unknown vehicle as not found', async () => {
    const { service } = harness();
    await expect(service.remove('no-such-car', DEALER_A)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("bulk delete removes the caller's vehicles and refuses the others", async () => {
    const { service, rows } = harness();
    const result = await service.removeMany({ ids: ['car-a', 'car-b'], confirm: true }, DEALER_B);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(rows.has('car-b')).toBe(false);
    expect(rows.has('car-a')).toBe(true);
    expect(result.outcomes.find((outcome) => outcome.id === 'car-a')?.ok).toBe(false);
  });
});
