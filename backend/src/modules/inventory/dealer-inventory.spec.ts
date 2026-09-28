import { NotFoundException } from '@nestjs/common';
import { dealerInventoryQuerySchema, type DealerInventoryQuery } from '@vintrax/shared';
import { DealerInventoryService } from './dealer-inventory.service';
import { InventoryService } from './inventory.service';

/**
 * The dealer inventory table, stats, select-all, export and duplicate.
 *
 * The in-memory stand-in below applies `sellerId` the way Postgres would, so a
 * query that forgot it would leak the other dealer's row into these results.
 */

const DEALER_A = { id: 'dealer-a', email: 'a@example.test', role: 'DEALER' } as never;
const DEALER_B = { id: 'dealer-b', email: 'b@example.test', role: 'DEALER' } as never;

interface Row {
  id: string;
  sellerId: string;
  slug: string;
  title: string;
  description: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  vin: string | null;
  stockNumber: string | null;
  mileageKm: number;
  priceCad: number;
  previousPriceCad: number | null;
  status: string;
  source: string;
  city: string;
  province: string;
  createdAt: Date;
  updatedAt: Date;
  images: Array<{ url: string; alt: string | null; position: number; assetId: string | null }>;
  [key: string]: unknown;
}

function car(id: string, sellerId: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    sellerId,
    slug: id,
    title: `Car ${id}`,
    description: 'A car.',
    year: 2020,
    make: 'Honda',
    model: 'Civic',
    trim: null,
    vin: `VIN-${id}`,
    stockNumber: `S-${id}`,
    mileageKm: 50_000,
    priceCad: 20_000,
    previousPriceCad: null,
    status: 'ACTIVE',
    source: 'MANUAL',
    city: 'Toronto',
    province: 'ON',
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
    images: [{ url: '/uploads/a.webp', alt: null, position: 0, assetId: 'asset-1' }],
    ...overrides,
  };
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND') continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const filter = value as Record<string, unknown>;
      if ('in' in filter && !(filter['in'] as unknown[]).includes(row[key])) return false;
      if (
        'equals' in filter &&
        String(row[key]).toLowerCase() !== String(filter['equals']).toLowerCase()
      )
        return false;
      if ('gte' in filter && (row[key] as number) < (filter['gte'] as number)) return false;
      if ('lte' in filter && (row[key] as number) > (filter['lte'] as number)) return false;
      continue;
    }
    if (row[key] !== value) return false;
  }
  return true;
}

function harness() {
  const rows = new Map<string, Row>([
    ['a1', car('a1', 'dealer-a', { status: 'ACTIVE', priceCad: 30_000 })],
    ['a2', car('a2', 'dealer-a', { status: 'DRAFT', source: 'CSV_IMPORT', make: 'Toyota' })],
    ['a3', car('a3', 'dealer-a', { status: 'SOLD', priceCad: 9_000 })],
    ['b1', car('b1', 'dealer-b', { status: 'ACTIVE', priceCad: 99_000 })],
  ]);
  const costs = [
    { vehicleId: 'a1', amountCents: 1_000_000 },
    { vehicleId: 'b1', amountCents: 5_000_000 },
  ];
  let created: Record<string, unknown> | null = null;
  let exportWhere: Record<string, unknown> | null = null;
  const audit = { record: jest.fn(async () => undefined) };

  const mine = (where: Record<string, unknown>) =>
    [...rows.values()].filter((row) => matches(row, where));

  const prisma = {
    vehicle: {
      count: async ({ where }: { where: Record<string, unknown> }) => mine(where).length,
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        exportWhere = where;
        return mine(where).map((row) => ({
          ...row,
          _count: { images: row.images.length },
          auctions: [],
        }));
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => mine(where)[0] ?? null,
      groupBy: async ({ where }: { where: Record<string, unknown> }) => {
        const counts = new Map<string, number>();
        for (const row of mine(where)) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
        return [...counts].map(([status, count]) => ({ status, _count: { _all: count } }));
      },
      aggregate: async ({ where }: { where: Record<string, unknown> }) => ({
        _sum: { priceCad: mine(where).reduce((sum, row) => sum + row.priceCad, 0) },
      }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created = data;
        return { id: 'copy-1' };
      },
    },
    vehicleCost: {
      groupBy: async ({ where }: { where: { vehicleId: { in: string[] } } }) =>
        costs
          .filter((cost) => where.vehicleId.in.includes(cost.vehicleId))
          .map((cost) => ({
            vehicleId: cost.vehicleId,
            _sum: { amountCents: cost.amountCents },
            _count: { _all: 1 },
          })),
      aggregate: async ({
        where,
      }: {
        where: { vehicle: { sellerId: string; status: { in: string[] } } };
      }) => ({
        _sum: {
          amountCents: costs
            .filter((cost) => {
              const row = rows.get(cost.vehicleId)!;
              return (
                row.sellerId === where.vehicle.sellerId &&
                where.vehicle.status.in.includes(row.status)
              );
            })
            .reduce((sum, cost) => sum + cost.amountCents, 0),
        },
      }),
    },
  };

  const vehicles = {
    uniqueSlug: async () => 'copy-slug',
    afterBulkWrite: async () => undefined,
  };

  const service = new DealerInventoryService(prisma as never, audit as never, vehicles as never);
  const inventory = Object.create(InventoryService.prototype) as InventoryService;
  Object.assign(inventory, { prisma });

  return {
    service,
    inventory,
    audit,
    created: () => created,
    exportWhere: () => exportWhere,
  };
}

const query = (input: Record<string, unknown> = {}): DealerInventoryQuery =>
  dealerInventoryQuerySchema.parse(input);

describe('dealer inventory', () => {
  it("lists the caller's vehicles and nobody else's", async () => {
    const { service } = harness();
    const page = await service.list(DEALER_A, query());

    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.id).sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it("carries each vehicle's own cost total, never another dealer's", async () => {
    const { service } = harness();
    const page = await service.list(DEALER_A, query());
    expect(page.items.find((item) => item.id === 'a1')?.totalCostCents).toBe(1_000_000);
    expect(page.items.some((item) => item.totalCostCents === 5_000_000)).toBe(false);
  });

  it('narrows by status, source, make and price without widening past the caller', async () => {
    const { service } = harness();
    expect(
      (await service.list(DEALER_A, query({ status: 'DRAFT' }))).items.map((i) => i.id),
    ).toEqual(['a2']);
    expect(
      (await service.list(DEALER_A, query({ source: 'CSV_IMPORT' }))).items.map((i) => i.id),
    ).toEqual(['a2']);
    expect(
      (await service.list(DEALER_A, query({ make: 'toyota' }))).items.map((i) => i.id),
    ).toEqual(['a2']);
    // Dealer B's car is the only one over $50,000; A must not see it.
    expect((await service.list(DEALER_A, query({ priceMin: '50000' }))).total).toBe(0);
  });

  it('always keeps the owner in the filter and never puts a term in a top-level OR', () => {
    const { service } = harness();
    const where = service.whereFor(DEALER_A, { q: 'civic 2020', make: 'Honda' });

    expect(where).toMatchObject({ sellerId: 'dealer-a' });
    expect(where).not.toHaveProperty('OR');
    expect(where['AND']).toHaveLength(2);
  });

  it('refuses a year or price range that runs backwards', () => {
    expect(() => query({ yearMin: '2022', yearMax: '2018' })).toThrow();
    expect(() => query({ priceMin: '9000', priceMax: '100' })).toThrow();
  });

  it('computes the stats over the caller only', async () => {
    const { service } = harness();
    const stats = await service.stats(DEALER_A);

    expect(stats).toMatchObject({ total: 3, active: 1, draft: 1, sold: 1 });
    // Sold vehicles are not stock, so the value is the active and draft cars.
    expect(stats.inventoryValueCad).toBe(30_000 + 20_000);
    expect(stats.inventoryCostCents).toBe(1_000_000);
  });

  it("selects every matching vehicle of the caller's, for bulk actions", async () => {
    const { service } = harness();
    const selection = await service.selection(DEALER_A, {});

    expect(selection.ids.sort()).toEqual(['a1', 'a2', 'a3']);
    expect(selection.truncated).toBe(false);
  });

  describe('duplicate', () => {
    it('copies the car into a new draft without its VIN or stock number', async () => {
      const { service, created, audit } = harness();
      await service.duplicate('a1', DEALER_A);

      expect(created()).toMatchObject({
        sellerId: 'dealer-a',
        status: 'DRAFT',
        source: 'MANUAL',
        vin: null,
        stockNumber: null,
        publishedAt: null,
        priceCad: 30_000,
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'vehicle.duplicated' }),
      );
    });

    it("refuses another dealer's vehicle as not found", async () => {
      const { service, created } = harness();
      await expect(service.duplicate('b1', DEALER_A)).rejects.toBeInstanceOf(NotFoundException);
      expect(created()).toBeNull();
    });
  });

  it("exports only the caller's vehicles, whatever ids are asked for", async () => {
    const { inventory, exportWhere } = harness();
    const csv = await inventory.exportInventory(DEALER_A, ['a1', 'b1']);

    expect(exportWhere()).toEqual({ sellerId: 'dealer-a', id: { in: ['a1', 'b1'] } });
    expect(csv).toContain('VIN-a1');
    expect(csv).not.toContain('VIN-b1');
  });
});

describe('dealer inventory for the other dealer', () => {
  it('sees only their own vehicle', async () => {
    const { service } = harness();
    const page = await service.list(DEALER_B, query());
    expect(page.items.map((item) => item.id)).toEqual(['b1']);
  });
});
