import { similarCarsQuerySchema, type ListingStatus } from '@vintrax/shared';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import { CarValueService } from './car-value.service';

// What a listing card shows is the mapper's business; here only which cars,
// in which order, matters.
jest.mock('../vehicles/vehicles.mapper', () => ({
  vehicleSummarySelect: {},
  toVehicleSummary: (row: { id: string }) => ({ id: row.id }),
}));

/**
 * "Similar cars on Vintrax": which listings count as similar, and the order
 * they come in. The stand-in database applies the same filters Postgres
 * would, so a query that let a draft or another model through fails here.
 */

interface Row {
  id: string;
  status: ListingStatus;
  make: string;
  model: string;
  year: number;
  trim: string | null;
  mileageKm: number;
  priceCad: number;
}

type Where = {
  status?: { in: string[] };
  make?: { equals: string };
  model?: { startsWith: string };
  year?: { gte: number; lte: number };
  id?: { in: string[] };
};

function fakePrisma(rows: Row[]) {
  const matches = (row: Row, where: Where) =>
    (!where.status || where.status.in.includes(row.status)) &&
    (!where.make || row.make.toLowerCase() === where.make.equals.toLowerCase()) &&
    (!where.model || row.model.toLowerCase().startsWith(where.model.startsWith.toLowerCase())) &&
    (!where.year || (row.year >= where.year.gte && row.year <= where.year.lte)) &&
    (!where.id || where.id.in.includes(row.id));
  return {
    vehicle: {
      findMany: jest.fn(async ({ where, take }: { where: Where; take?: number }) => {
        const found = rows.filter((row) => matches(row, where));
        return found.slice(0, take ?? found.length);
      }),
    },
  };
}

function car(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    status: 'ACTIVE',
    make: 'Nissan',
    model: 'Altima',
    year: 2018,
    trim: null,
    mileageKm: 100_000,
    priceCad: 15_000,
    ...overrides,
  };
}

function service(rows: Row[]) {
  const prisma = fakePrisma(rows);
  return {
    prisma,
    carValue: new CarValueService(
      prisma as unknown as PrismaService,
      {} as unknown as RedisService,
    ),
  };
}

const query = (input: Record<string, unknown>) => similarCarsQuerySchema.parse(input);

describe('CarValueService.similar', () => {
  it('lists every public car of that make and model within three years, and nothing else', async () => {
    const { carValue } = service([
      car('same-year'),
      car('three-years-older', { year: 2015 }),
      car('four-years-older', { year: 2014 }),
      car('at-auction', { status: 'IN_AUCTION', year: 2019 }),
      car('draft', { status: 'DRAFT' }),
      car('sold', { status: 'SOLD' }),
      car('other-model', { model: 'Sentra' }),
      car('other-make', { make: 'Toyota', model: 'Altima' }),
      car('longer-model-name', { model: 'Altima Coupe' }),
      car('name-inside-another', { model: 'Maxima Altima' }),
    ]);

    const result = await carValue.similar(query({ year: 2018, make: 'nissan', model: 'altima' }));

    expect(result.items.map((item) => item.id).sort()).toEqual(
      ['at-auction', 'longer-model-name', 'same-year', 'three-years-older'].sort(),
    );
    expect(result.total).toBe(4);
    expect(result.yearsCompared).toEqual({ from: 2015, to: 2021 });
  });

  it('puts the closest year first, then the same trim, then the closest kilometres', async () => {
    const { carValue } = service([
      car('two-years-off', { year: 2020, mileageKm: 60_000 }),
      car('same-year-far-km', { mileageKm: 200_000 }),
      car('same-year-near-km', { mileageKm: 62_000 }),
      car('same-year-same-trim', { trim: 'SV', mileageKm: 150_000 }),
      car('one-year-off', { year: 2017, mileageKm: 60_000 }),
    ]);

    const result = await carValue.similar(
      query({ year: 2018, make: 'Nissan', model: 'Altima', trim: 'sv', mileageKm: 60_000 }),
    );

    expect(result.items.map((item) => item.id)).toEqual([
      'same-year-same-trim',
      'same-year-near-km',
      'same-year-far-km',
      'one-year-off',
      'two-years-off',
    ]);
  });

  it('pages through them, and a page past the end shows the last one', async () => {
    const rows = Array.from({ length: 45 }, (_, index) =>
      car(`car-${String(index).padStart(2, '0')}`, { priceCad: 10_000 + index }),
    );
    const { carValue } = service(rows);

    const first = await carValue.similar(
      query({ year: 2018, make: 'Nissan', model: 'Altima', pageSize: 20 }),
    );
    expect(first).toMatchObject({ page: 1, total: 45, totalPages: 3 });
    expect(first.items).toHaveLength(20);
    // Same year and trim, no kilometres given: cheapest first.
    expect(first.items[0]!.id).toBe('car-00');

    const past = await carValue.similar(
      query({ year: 2018, make: 'Nissan', model: 'Altima', pageSize: 20, page: 9 }),
    );
    expect(past.page).toBe(3);
    expect(past.items.map((item) => item.id)).toEqual([
      'car-40',
      'car-41',
      'car-42',
      'car-43',
      'car-44',
    ]);
  });

  it('says so when nothing is listed, without loading any summaries', async () => {
    const { carValue, prisma } = service([car('other', { model: 'Rogue' })]);

    const result = await carValue.similar(query({ year: 2007, make: 'Nissan', model: 'Altima' }));

    expect(result).toMatchObject({ items: [], total: 0, totalPages: 1, page: 1 });
    expect(prisma.vehicle.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('similarCarsQuerySchema', () => {
  it('needs a year, make and model; kilometres and trim are optional', () => {
    expect(
      similarCarsQuerySchema.safeParse({ year: '2007', make: 'Nissan', model: 'Altima' }).success,
    ).toBe(true);
    expect(similarCarsQuerySchema.safeParse({ year: '2007', make: 'Nissan' }).success).toBe(false);
    expect(similarCarsQuerySchema.safeParse({ make: 'Nissan', model: 'Altima' }).success).toBe(
      false,
    );
  });

  it('caps the page size', () => {
    expect(
      similarCarsQuerySchema.safeParse({
        year: 2007,
        make: 'Nissan',
        model: 'Altima',
        pageSize: 500,
      }).success,
    ).toBe(false);
  });
});
