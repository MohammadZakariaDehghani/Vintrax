import { NotFoundException } from '@nestjs/common';
import { searchListingsSchema } from '@atlas/shared';
import type { Prisma } from '@prisma/client';
import { ListingsService } from './listings.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../../common/auth/auth-user';

/**
 * These tests exercise query construction and visibility rules, which is where
 * the interesting logic lives. Prisma is stubbed so they stay fast and need no
 * database; the queries themselves are covered by the API smoke tests.
 */
function createService() {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const groupBy = jest.fn().mockResolvedValue([]);
  const findUnique = jest.fn().mockResolvedValue(null);
  const update = jest.fn().mockResolvedValue({});
  const favouriteFindMany = jest.fn().mockResolvedValue([]);

  const prisma = {
    listing: { findMany, count, groupBy, findUnique, update },
    favourite: { findMany: favouriteFindMany },
  } as unknown as PrismaService;

  return {
    service: new ListingsService(prisma),
    findMany,
    findUnique,
    update,
    favouriteFindMany,
  };
}

/** Parses through the real schema so tests share the app's coercion and defaults. */
const query = (raw: Record<string, unknown>) => searchListingsSchema.parse(raw);

const capturedWhere = (findMany: jest.Mock): Prisma.ListingWhereInput =>
  findMany.mock.calls[0]![0].where;

describe('ListingsService.search', () => {
  it('only ever exposes active listings', async () => {
    const { service, findMany } = createService();
    await service.search(query({}));
    expect(capturedWhere(findMany).status).toBe('ACTIVE');
  });

  it('requires every free-text term to match, across any field', async () => {
    const { service, findMany } = createService();
    await service.search(query({ q: 'blue rav4' }));

    const and = capturedWhere(findMany).AND as Prisma.ListingWhereInput[];
    expect(and).toHaveLength(2);
    // Each term becomes its own OR group, so the terms are ANDed together.
    expect(and[0]!.OR).toEqual(expect.arrayContaining([{ make: { contains: 'blue', mode: 'insensitive' } }]));
    expect(and[1]!.OR).toEqual(expect.arrayContaining([{ make: { contains: 'rav4', mode: 'insensitive' } }]));
  });

  it('maps category words onto the enum columns they describe', async () => {
    const { service, findMany } = createService();
    await service.search(query({ q: 'suv' }));

    const and = capturedWhere(findMany).AND as Prisma.ListingWhereInput[];
    expect(and[0]!.OR).toEqual(expect.arrayContaining([{ bodyType: 'SUV' }]));
  });

  it('understands the shorthands buyers actually type', async () => {
    const { service, findMany } = createService();
    await service.search(query({ q: '4x4' }));

    const and = capturedWhere(findMany).AND as Prisma.ListingWhereInput[];
    expect(and[0]!.OR).toEqual(expect.arrayContaining([{ drivetrain: 'FOUR_WHEEL_DRIVE' }]));
  });

  it('skips prose matching for very short terms to avoid substring noise', async () => {
    const { service, findMany } = createService();
    await service.search(query({ q: 'ev' }));

    const or = (capturedWhere(findMany).AND as Prisma.ListingWhereInput[])[0]!.OR!;
    expect(or).toEqual(expect.arrayContaining([{ fuelType: 'ELECTRIC' }]));
    expect(or.some((clause) => 'description' in clause)).toBe(false);
  });

  it('accepts comma-separated multi-select filters', async () => {
    const { service, findMany } = createService();
    await service.search(query({ bodyType: 'SUV,TRUCK' }));
    expect(capturedWhere(findMany).bodyType).toEqual({ in: ['SUV', 'TRUCK'] });
  });

  it('translates price and year ranges into bounded filters', async () => {
    const { service, findMany } = createService();
    await service.search(query({ minPrice: '10000', maxPrice: '30000', minYear: '2018' }));

    const where = capturedWhere(findMany);
    expect(where.priceCad).toEqual({ gte: 10000, lte: 30000 });
    expect(where.year).toEqual({ gte: 2018 });
  });

  it('sorts by price ascending with a stable tiebreaker', async () => {
    const { service, findMany } = createService();
    await service.search(query({ sort: 'PRICE_ASC' }));
    expect(findMany.mock.calls[0]![0].orderBy).toEqual([{ priceCad: 'asc' }, { id: 'asc' }]);
  });

  it('paginates using the requested page size', async () => {
    const { service, findMany } = createService();
    await service.search(query({ page: '3', pageSize: '10' }));

    expect(findMany.mock.calls[0]![0].skip).toBe(20);
    expect(findMany.mock.calls[0]![0].take).toBe(10);
  });
});

describe('ListingsService.findById', () => {
  const seller = { id: 'seller-1', displayName: 'Dealer', role: 'DEALER' as const, province: null, city: null, createdAt: new Date(), dealership: null };
  const draftRow = {
    id: 'listing-1',
    status: 'DRAFT',
    seller,
    images: [],
    _count: { images: 0 },
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('hides an unpublished listing from other users', async () => {
    const { service, findUnique } = createService();
    findUnique.mockResolvedValue(draftRow);

    const stranger: AuthUser = { id: 'someone-else', email: 'a@b.test', displayName: 'A', role: 'BUYER' };
    // Reported as 404 rather than 403 so drafts are not discoverable by probing.
    await expect(service.findById('listing-1', stranger)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not count the seller viewing their own listing', async () => {
    const { service, findUnique, update } = createService();
    findUnique.mockResolvedValue({ ...draftRow, status: 'ACTIVE' });

    const owner: AuthUser = { id: 'seller-1', email: 'd@b.test', displayName: 'Dealer', role: 'DEALER' };
    await service.findById('listing-1', owner);

    expect(update).not.toHaveBeenCalled();
  });

  it('counts a view from an anonymous visitor', async () => {
    const { service, findUnique, update } = createService();
    findUnique.mockResolvedValue({ ...draftRow, status: 'ACTIVE' });

    await service.findById('listing-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'listing-1' },
      data: { viewCount: { increment: 1 } },
    });
  });
});
