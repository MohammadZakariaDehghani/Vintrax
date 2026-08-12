import { Injectable, Logger } from '@nestjs/common';
import type { SearchVehiclesQuery, VehicleSearchResponse } from '@atlas/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  toVehicleSummary,
  vehicleSummarySelect,
} from '../../modules/vehicles/vehicles.mapper';
import type { SearchProvider } from './search.types';

/**
 * Search backed by PostgreSQL.
 *
 * Structured filters run through Prisma's query builder, so they are typed and
 * parameterised. Keyword relevance uses the generated `searchVector` column with
 * `ts_rank`, which requires raw SQL — Prisma cannot express generated columns.
 * The raw query returns ranked ids only, and the page is then hydrated through
 * Prisma so the mapper keeps its static types.
 */
@Injectable()
export class PostgresSearchProvider implements SearchProvider {
  readonly name = 'postgres' as const;
  private readonly logger = new Logger(PostgresSearchProvider.name);

  constructor(private readonly prisma: PrismaService) {}

  async search(query: SearchVehiclesQuery, viewerId?: string): Promise<VehicleSearchResponse> {
    const startedAt = Date.now();
    const where = this.buildWhere(query);

    // A keyword query needs ts_rank, so the id ordering comes from raw SQL.
    const rankedIds = query.q ? await this.rankedIds(query, where) : null;

    const effectiveWhere: Prisma.VehicleWhereInput = rankedIds
      ? { AND: [where, { id: { in: rankedIds.ids } }] }
      : where;

    const total = rankedIds ? rankedIds.total : await this.prisma.vehicle.count({ where });

    const rows = await this.prisma.vehicle.findMany({
      where: effectiveWhere,
      select: vehicleSummarySelect,
      // Ranked results are re-sorted in memory below; unranked ones sort in SQL.
      orderBy: rankedIds ? undefined : this.buildOrderBy(query.sort),
      ...(rankedIds ? {} : { skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    });

    const ordered = rankedIds
      ? rankedIds.ids
          .map((id) => rows.find((row) => row.id === id))
          .filter((row): row is (typeof rows)[number] => Boolean(row))
      : rows;

    const favouritedIds = await this.favouritedIds(
      viewerId,
      ordered.map((row) => row.id),
    );

    return {
      items: ordered.map((row) => toVehicleSummary(row, favouritedIds)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      facets: await this.buildFacets(where),
      provider: this.name,
      tookMs: Date.now() - startedAt,
    };
  }

  // The PostgreSQL provider reads the live table, so there is no index to keep.
  async indexVehicle(): Promise<void> {}
  async removeVehicle(): Promise<void> {}
  async reindexAll(): Promise<{ indexed: number }> {
    return { indexed: 0 };
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ranked ids for a keyword search.
   *
   * `websearch_to_tsquery` accepts what users actually type — quoted phrases,
   * `or`, and leading `-` for exclusion — without throwing on syntax the way
   * `to_tsquery` does. When it matches nothing, the trigram similarity fallback
   * catches misspelled makes and models.
   */
  private async rankedIds(
    query: SearchVehiclesQuery,
    where: Prisma.VehicleWhereInput,
  ): Promise<{ ids: string[]; total: number }> {
    const term = query.q!.trim();
    const filterIds = await this.prisma.vehicle.findMany({ where, select: { id: true } });
    if (filterIds.length === 0) return { ids: [], total: 0 };

    const candidateIds = filterIds.map((row) => row.id);
    const offset = (query.page - 1) * query.pageSize;

    const ranked = await this.prisma.$queryRaw<Array<{ id: string; rank: number }>>`
      SELECT id,
             ts_rank("searchVector", websearch_to_tsquery('english', ${term})) AS rank
      FROM "Vehicle"
      WHERE id = ANY(${candidateIds}::uuid[])
        AND "searchVector" @@ websearch_to_tsquery('english', ${term})
      ORDER BY rank DESC, "publishedAt" DESC NULLS LAST, id ASC
      LIMIT ${query.pageSize} OFFSET ${offset}
    `;

    const countRows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Vehicle"
      WHERE id = ANY(${candidateIds}::uuid[])
        AND "searchVector" @@ websearch_to_tsquery('english', ${term})
    `;
    const count = countRows[0]?.count ?? 0n;

    if (Number(count) > 0) {
      return { ids: ranked.map((row) => row.id), total: Number(count) };
    }

    // Nothing matched the full-text query — try fuzzy make/model matching before
    // telling the user there are no results.
    const fuzzy = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "Vehicle"
      WHERE id = ANY(${candidateIds}::uuid[])
        AND (similarity("make", ${term}) > 0.3 OR similarity("model", ${term}) > 0.3)
      ORDER BY GREATEST(similarity("make", ${term}), similarity("model", ${term})) DESC, id ASC
      LIMIT ${query.pageSize} OFFSET ${offset}
    `;

    const fuzzyCountRows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Vehicle"
      WHERE id = ANY(${candidateIds}::uuid[])
        AND (similarity("make", ${term}) > 0.3 OR similarity("model", ${term}) > 0.3)
    `;

    return { ids: fuzzy.map((row) => row.id), total: Number(fuzzyCountRows[0]?.count ?? 0n) };
  }

  private buildWhere(query: SearchVehiclesQuery): Prisma.VehicleWhereInput {
    // Only published inventory is publicly searchable.
    const where: Prisma.VehicleWhereInput = {
      status: { in: ['ACTIVE', 'IN_AUCTION'] },
    };

    if (query.make) where.make = { equals: query.make, mode: 'insensitive' };
    if (query.model) where.model = { contains: query.model, mode: 'insensitive' };
    if (query.city) where.city = { contains: query.city, mode: 'insensitive' };
    if (query.province) where.province = query.province;

    if (query.minYear !== undefined || query.maxYear !== undefined) {
      where.year = {
        ...(query.minYear !== undefined ? { gte: query.minYear } : {}),
        ...(query.maxYear !== undefined ? { lte: query.maxYear } : {}),
      };
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.priceCad = {
        ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
      };
    }

    if (query.maxMileageKm !== undefined) where.mileageKm = { lte: query.maxMileageKm };

    if (query.bodyType) where.bodyType = { in: query.bodyType };
    if (query.fuelType) where.fuelType = { in: query.fuelType };
    if (query.transmission) where.transmission = { in: query.transmission };
    if (query.drivetrain) where.drivetrain = { in: query.drivetrain };
    if (query.condition) where.condition = { in: query.condition };
    if (query.saleChannel) where.saleChannel = { in: query.saleChannel };

    if (query.sellerType) where.seller = { role: query.sellerType };

    if (query.inspectedOnly) {
      where.inspections = { some: { status: 'COMPLETED' } };
    }

    return where;
  }

  private buildOrderBy(
    sort: SearchVehiclesQuery['sort'],
  ): Prisma.VehicleOrderByWithRelationInput[] {
    // A tiebreaker on id keeps pagination stable when sort values collide.
    switch (sort) {
      case 'PRICE_ASC':
        return [{ priceCad: 'asc' }, { id: 'asc' }];
      case 'PRICE_DESC':
        return [{ priceCad: 'desc' }, { id: 'asc' }];
      case 'MILEAGE_ASC':
        return [{ mileageKm: 'asc' }, { id: 'asc' }];
      case 'YEAR_DESC':
        return [{ year: 'desc' }, { id: 'asc' }];
      case 'ENDING_SOON':
        // Vehicles without an auction sort last.
        return [{ auctions: { _count: 'desc' } }, { publishedAt: 'desc' }, { id: 'asc' }];
      case 'NEWEST':
      case 'RELEVANCE':
      default:
        return [{ publishedAt: 'desc' }, { id: 'asc' }];
    }
  }

  private async favouritedIds(
    viewerId: string | undefined,
    vehicleIds: string[],
  ): Promise<ReadonlySet<string>> {
    if (!viewerId || vehicleIds.length === 0) return new Set();
    const rows = await this.prisma.favourite.findMany({
      where: { userId: viewerId, vehicleId: { in: vehicleIds } },
      select: { vehicleId: true },
    });
    return new Set(rows.map((row) => row.vehicleId));
  }

  /**
   * Facet counts share the results' filters, so they describe what is reachable
   * from the current search rather than the whole catalogue.
   */
  private async buildFacets(
    where: Prisma.VehicleWhereInput,
  ): Promise<VehicleSearchResponse['facets']> {
    const [makes, bodyTypes, fuelTypes, provinces, priceRange] = await Promise.all([
      this.prisma.vehicle.groupBy({
        by: ['make'],
        where,
        _count: { _all: true },
        orderBy: { _count: { make: 'desc' } },
        take: 15,
      }),
      this.prisma.vehicle.groupBy({ by: ['bodyType'], where, _count: { _all: true } }),
      this.prisma.vehicle.groupBy({ by: ['fuelType'], where, _count: { _all: true } }),
      this.prisma.vehicle.groupBy({ by: ['province'], where, _count: { _all: true } }),
      this.prisma.vehicle.aggregate({
        where,
        _min: { priceCad: true },
        _max: { priceCad: true },
      }),
    ]);

    const byCountDesc = <T extends { count: number }>(a: T, b: T) => b.count - a.count;

    return {
      makes: makes.map((row) => ({ value: row.make, count: row._count._all })),
      bodyTypes: bodyTypes
        .map((row) => ({ value: row.bodyType, count: row._count._all }))
        .sort(byCountDesc),
      fuelTypes: fuelTypes
        .map((row) => ({ value: row.fuelType, count: row._count._all }))
        .sort(byCountDesc),
      provinces: provinces
        .map((row) => ({ value: row.province, count: row._count._all }))
        .sort(byCountDesc),
      priceRange:
        priceRange._min.priceCad !== null && priceRange._max.priceCad !== null
          ? { min: priceRange._min.priceCad, max: priceRange._max.priceCad }
          : null,
    };
  }
}
