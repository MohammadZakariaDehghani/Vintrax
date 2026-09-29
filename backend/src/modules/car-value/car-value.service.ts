import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  CarValueOption,
  ListingStatus,
  SimilarCars,
  SimilarCarsQuery,
  VehicleValueEstimate,
  VehicleValueQuery,
} from '@vintrax/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { toVehicleSummary, vehicleSummarySelect } from '../vehicles/vehicles.mapper';
import { estimateValue } from './value-estimate';

/** Listings anyone may see: for sale, at auction, or sold. Sold prices are the best evidence of all. */
const EVIDENCE_STATUSES: ListingStatus[] = ['ACTIVE', 'IN_AUCTION', 'SOLD'];

/** Model years either side of the visitor's, first narrowly, then wider if that finds too few. */
const NEAR_YEARS = 1;
const WIDE_YEARS = 3;
/** Below this many close cars the search widens to `WIDE_YEARS`. */
const ENOUGH_NEAR = 8;
/** Comparable cars read per estimate; more says nothing new. */
const MAX_COMPARABLES = 400;
/** How many of them the page shows. */
const SHOWN_COMPARABLES = 6;

/** Listings a buyer can open: the same set the vehicle search shows. */
const FOR_SALE_STATUSES: ListingStatus[] = ['ACTIVE', 'IN_AUCTION'];
/** Similar cars ranked per request; far more than any make and model has listed. */
const MAX_SIMILAR = 1_000;

const OPTIONS_TTL = 600;

@Injectable()
export class CarValueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Makes with at least one listing to value against, most common first. */
  makes(): Promise<CarValueOption[]> {
    return this.redis.remember('car-value:makes', OPTIONS_TTL, async () => {
      const rows = await this.prisma.vehicle.groupBy({
        by: ['make'],
        where: { status: { in: EVIDENCE_STATUSES } },
        _count: { _all: true },
      });
      return rows
        .map((row) => ({ value: row.make, count: row._count._all }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    });
  }

  /** That make's models, most common first. */
  models(make: string): Promise<CarValueOption[]> {
    return this.redis.remember(`car-value:models:${make.toLowerCase()}`, OPTIONS_TTL, async () => {
      const rows = await this.prisma.vehicle.groupBy({
        by: ['model'],
        where: {
          status: { in: EVIDENCE_STATUSES },
          make: { equals: make, mode: 'insensitive' },
        },
        _count: { _all: true },
      });
      return rows
        .map((row) => ({ value: row.model, count: row._count._all }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    });
  }

  /**
   * Every car for sale like the visitor's: that make, a model starting with
   * theirs ("Civic" finds a "Civic Hatchback", "3" does not find a "CX-30"),
   * within `WIDE_YEARS` of their year.
   *
   * Closest first: nearest model year, then the same trim, then the nearest
   * kilometres. That order is not something SQL can sort by, so the few
   * columns it needs are read for every match and one page is then loaded.
   */
  async similar(query: SimilarCarsQuery): Promise<SimilarCars> {
    const from = query.year - WIDE_YEARS;
    const to = query.year + WIDE_YEARS;
    const rows = await this.prisma.vehicle.findMany({
      where: {
        status: { in: FOR_SALE_STATUSES },
        make: { equals: query.make, mode: 'insensitive' },
        model: { startsWith: query.model, mode: 'insensitive' },
        year: { gte: from, lte: to },
      },
      select: { id: true, year: true, trim: true, mileageKm: true, priceCad: true },
      orderBy: { id: 'asc' },
      take: MAX_SIMILAR,
    });

    const trim = query.trim?.toLowerCase();
    const trimRank = (value: string | null) => (trim && value?.toLowerCase() === trim ? 0 : 1);
    const kmGap = (value: number) =>
      query.mileageKm === undefined ? 0 : Math.abs(value - query.mileageKm);
    rows.sort(
      (a, b) =>
        Math.abs(a.year - query.year) - Math.abs(b.year - query.year) ||
        trimRank(a.trim) - trimRank(b.trim) ||
        kmGap(a.mileageKm) - kmGap(b.mileageKm) ||
        a.priceCad - b.priceCad,
    );

    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const ids = rows.slice((page - 1) * query.pageSize, page * query.pageSize).map((row) => row.id);
    const summaries = ids.length
      ? await this.prisma.vehicle.findMany({
          where: { id: { in: ids } },
          select: vehicleSummarySelect,
        })
      : [];
    const byId = new Map(summaries.map((row) => [row.id, row]));

    return {
      items: ids
        .map((id) => byId.get(id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .map((row) => toVehicleSummary(row, new Set())),
      page,
      pageSize: query.pageSize,
      total,
      totalPages,
      yearsCompared: { from, to },
    };
  }

  async estimate(query: VehicleValueQuery): Promise<VehicleValueEstimate> {
    const base: Prisma.VehicleWhereInput = {
      status: { in: EVIDENCE_STATUSES },
      make: { equals: query.make, mode: 'insensitive' },
      model: { equals: query.model, mode: 'insensitive' },
      priceCad: { gt: 0 },
    };
    const read = (spread: number) =>
      this.prisma.vehicle.findMany({
        where: { ...base, year: { gte: query.year - spread, lte: query.year + spread } },
        select: { id: true, year: true, mileageKm: true, priceCad: true, trim: true, status: true },
        orderBy: { updatedAt: 'desc' },
        take: MAX_COMPARABLES,
      });

    let spread = NEAR_YEARS;
    let rows = await read(spread);
    if (rows.length < ENOUGH_NEAR) {
      spread = WIDE_YEARS;
      rows = await read(spread);
    }

    const result = estimateValue(query, rows);

    // The closest cars still for sale, so the visitor can see what the figure
    // rests on — and, if they are buying rather than selling, go and look.
    const closest = rows
      .filter((row) => row.status === 'ACTIVE')
      .sort(
        (a, b) =>
          Math.abs(a.year - query.year) - Math.abs(b.year - query.year) ||
          Math.abs(a.mileageKm - query.mileageKm) - Math.abs(b.mileageKm - query.mileageKm),
      )
      .slice(0, SHOWN_COMPARABLES)
      .map((row) => row.id);
    const summaries = closest.length
      ? await this.prisma.vehicle.findMany({
          where: { id: { in: closest } },
          select: vehicleSummarySelect,
        })
      : [];
    const byId = new Map(summaries.map((row) => [row.id, row]));

    const averageMileageKm = rows.length
      ? Math.round(rows.reduce((sum, row) => sum + row.mileageKm, 0) / rows.length)
      : null;

    return {
      query: {
        year: query.year,
        make: query.make,
        model: query.model,
        trim: query.trim ?? null,
        mileageKm: query.mileageKm,
        province: query.province ?? null,
      },
      estimate: result
        ? {
            marketValue: result.marketValue,
            low: result.low,
            high: result.high,
            tradeInLow: result.tradeInLow,
            tradeInHigh: result.tradeInHigh,
            confidence: result.confidence,
          }
        : null,
      comparableCount: result?.used ?? rows.length,
      yearsCompared: { from: query.year - spread, to: query.year + spread },
      averageMileageKm,
      comparables: closest
        .map((id) => byId.get(id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .map((row) => toVehicleSummary(row, new Set())),
    };
  }
}
