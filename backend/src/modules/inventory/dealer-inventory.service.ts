import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MAX_INVENTORY_SELECTION,
  listingQuality,
  type DealerInventoryFilter,
  type DealerInventoryItem,
  type DealerInventoryPage,
  type DealerInventoryQuery,
  type DealerInventorySelection,
  type DealerInventorySort,
  type DealerInventoryStats,
  type ListingStatus,
} from '@vintrax/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { VehiclesService } from '../vehicles/vehicles.service';
import { optimizedFrom, vehicleImageSelect } from '../vehicles/vehicles.mapper';

/** Statuses whose vehicles still count as stock: everything but sold and archived. */
const IN_STOCK: ListingStatus[] = ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'IN_AUCTION'];

const ORDER_BY: Record<DealerInventorySort, Prisma.VehicleOrderByWithRelationInput[]> = {
  updated_desc: [{ updatedAt: 'desc' }],
  updated_asc: [{ updatedAt: 'asc' }],
  price_desc: [{ priceCad: 'desc' }, { updatedAt: 'desc' }],
  price_asc: [{ priceCad: 'asc' }, { updatedAt: 'desc' }],
  year_desc: [{ year: 'desc' }, { updatedAt: 'desc' }],
  year_asc: [{ year: 'asc' }, { updatedAt: 'desc' }],
  mileage_asc: [{ mileageKm: 'asc' }, { updatedAt: 'desc' }],
  mileage_desc: [{ mileageKm: 'desc' }, { updatedAt: 'desc' }],
  created_desc: [{ createdAt: 'desc' }],
};

const ITEM_SELECT = {
  id: true,
  slug: true,
  title: true,
  year: true,
  make: true,
  model: true,
  trim: true,
  vin: true,
  stockNumber: true,
  mileageKm: true,
  priceCad: true,
  previousPriceCad: true,
  status: true,
  source: true,
  city: true,
  province: true,
  createdAt: true,
  updatedAt: true,
  // What the listing-quality score reads.
  description: true,
  features: true,
  exteriorColour: true,
  interiorColour: true,
  doors: true,
  seats: true,
  engine: true,
  horsepower: true,
  ownerCount: true,
  isDamaged: true,
  images: { select: vehicleImageSelect, orderBy: { position: 'asc' }, take: 1 },
  _count: { select: { images: true } },
  auctions: {
    where: { status: { in: ['SCHEDULED', 'LIVE'] } },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.VehicleSelect;

/**
 * The dealer's own inventory, as the portal's table reads it.
 *
 * Every query here starts from `sellerId: user.id`, taken from the session and
 * never from the request. The filters narrow within that; none of them can
 * name another seller. Administrators get no wider view here either — this is
 * "my inventory", and the admin tools are where other people's vehicles are
 * managed.
 *
 * Writes (create, edit, status, delete) are not reimplemented: the portal calls
 * the existing `/vehicles` routes, whose ownership, auction and sold-vehicle
 * guards already apply. The one write here is duplicate, which goes through
 * the same ownership check.
 */
@Injectable()
export class DealerInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly vehicles: VehiclesService,
  ) {}

  /** The `where` for a filter, always scoped to the caller. Exported for tests. */
  whereFor(user: AuthUser, filter: DealerInventoryFilter): Prisma.VehicleWhereInput {
    const terms = (filter.q ?? '')
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 6);

    const and: Prisma.VehicleWhereInput[] = terms.map((term) => ({
      OR: [
        { title: { contains: term, mode: 'insensitive' } },
        { make: { contains: term, mode: 'insensitive' } },
        { model: { contains: term, mode: 'insensitive' } },
        { trim: { contains: term, mode: 'insensitive' } },
        { vin: { contains: term, mode: 'insensitive' } },
        { stockNumber: { contains: term, mode: 'insensitive' } },
        ...(/^\d{4}$/.test(term) ? [{ year: Number(term) }] : []),
      ],
    }));

    const price: Prisma.IntFilter = {};
    if (filter.priceMin !== undefined) price.gte = filter.priceMin;
    if (filter.priceMax !== undefined) price.lte = filter.priceMax;
    const year: Prisma.IntFilter = {};
    if (filter.yearMin !== undefined) year.gte = filter.yearMin;
    if (filter.yearMax !== undefined) year.lte = filter.yearMax;

    return {
      // First and unconditional. Nothing below can widen it.
      sellerId: user.id,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.source ? { source: filter.source } : {}),
      ...(filter.make ? { make: { equals: filter.make, mode: 'insensitive' } } : {}),
      ...(filter.model ? { model: { contains: filter.model, mode: 'insensitive' } } : {}),
      ...(Object.keys(price).length > 0 ? { priceCad: price } : {}),
      ...(Object.keys(year).length > 0 ? { year } : {}),
      ...(and.length > 0 ? { AND: and } : {}),
    };
  }

  async list(user: AuthUser, query: DealerInventoryQuery): Promise<DealerInventoryPage> {
    const where = this.whereFor(user, query);
    const [total, rows] = await Promise.all([
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.findMany({
        where,
        select: ITEM_SELECT,
        orderBy: ORDER_BY[query.sort],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    const costs = await this.costTotals(rows.map((row) => row.id));

    return {
      items: rows.map((row) => {
        const cost = costs.get(row.id);
        const item: DealerInventoryItem = {
          id: row.id,
          slug: row.slug,
          title: row.title,
          year: row.year,
          make: row.make,
          model: row.model,
          trim: row.trim,
          vin: row.vin,
          stockNumber: row.stockNumber,
          mileageKm: row.mileageKm,
          priceCad: row.priceCad,
          previousPriceCad: row.previousPriceCad,
          status: row.status,
          source: row.source,
          city: row.city,
          province: row.province,
          primaryImageUrl: row.images[0]?.url ?? null,
          primaryImage: optimizedFrom(row.images[0]?.asset ?? null),
          imageCount: row._count.images,
          totalCostCents: cost?.total ?? 0,
          costCount: cost?.count ?? 0,
          inLiveAuction: row.auctions.length > 0,
          qualityScore: listingQuality({ ...row, imageCount: row._count.images }).score,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
        return item;
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /**
   * Every id matching the filter, for "select all N vehicles". Capped, and
   * says so, rather than silently stopping short.
   */
  async selection(
    user: AuthUser,
    filter: DealerInventoryFilter,
  ): Promise<DealerInventorySelection> {
    const where = this.whereFor(user, filter);
    const [total, rows] = await Promise.all([
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.findMany({
        where,
        select: { id: true },
        orderBy: [{ updatedAt: 'desc' }],
        take: MAX_INVENTORY_SELECTION,
      }),
    ]);
    return {
      ids: rows.map((row) => row.id),
      total,
      truncated: total > rows.length,
    };
  }

  /** Aggregated on the server, over the caller's rows only. */
  async stats(user: AuthUser): Promise<DealerInventoryStats> {
    const mine: Prisma.VehicleWhereInput = { sellerId: user.id };

    const [byStatus, value, cost, makes] = await Promise.all([
      this.prisma.vehicle.groupBy({
        by: ['status'],
        where: mine,
        _count: { _all: true },
      }),
      this.prisma.vehicle.aggregate({
        where: { ...mine, status: { in: IN_STOCK } },
        _sum: { priceCad: true },
      }),
      this.prisma.vehicleCost.aggregate({
        where: { vehicle: { sellerId: user.id, status: { in: IN_STOCK } } },
        _sum: { amountCents: true },
      }),
      this.prisma.vehicle.findMany({
        where: mine,
        distinct: ['make'],
        select: { make: true },
        orderBy: { make: 'asc' },
        take: 200,
      }),
    ]);

    const count = (status: ListingStatus) =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;

    return {
      total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
      active: count('ACTIVE'),
      sold: count('SOLD'),
      draft: count('DRAFT'),
      inReview: count('PENDING_REVIEW'),
      inAuction: count('IN_AUCTION'),
      archived: count('ARCHIVED'),
      inventoryValueCad: value._sum.priceCad ?? 0,
      inventoryCostCents: cost._sum.amountCents ?? 0,
      makes: dedupeCaseInsensitive(makes.map((row) => row.make)),
    };
  }

  /**
   * Copies a vehicle into a new draft, for listing a second car like it.
   *
   * What identifies the physical car is left behind: the VIN, the stock
   * number, the documents and history (which are about that VIN), the
   * inspections and the costs. What describes the kind of car comes along —
   * specification, price, description, features and photos, which the dealer
   * will usually replace. The copy is a DRAFT like any new listing, so it is
   * not public until it goes through review.
   */
  async duplicate(id: string, user: AuthUser): Promise<{ id: string }> {
    const source = await this.prisma.vehicle.findFirst({
      // Scoped by owner in the query itself: someone else's id is simply not
      // found, which is also what this reports, so it does not confirm the
      // vehicle exists.
      where: { id, sellerId: user.id },
      include: { images: { orderBy: { position: 'asc' } } },
    });
    if (!source) throw new NotFoundException('Vehicle not found');

    const created = await this.prisma.vehicle.create({
      data: {
        slug: await this.vehicles.uniqueSlug(
          source.year,
          source.make,
          source.model,
          source.trim ?? undefined,
        ),
        sellerId: user.id,
        title: source.title,
        description: source.description,
        vin: null,
        stockNumber: null,
        make: source.make,
        model: source.model,
        trim: source.trim,
        year: source.year,
        priceCad: source.priceCad,
        reservePriceCad: source.reservePriceCad,
        mileageKm: source.mileageKm,
        condition: source.condition,
        bodyType: source.bodyType,
        transmission: source.transmission,
        fuelType: source.fuelType,
        drivetrain: source.drivetrain,
        engine: source.engine,
        engineSizeL: source.engineSizeL,
        cylinders: source.cylinders,
        doors: source.doors,
        seats: source.seats,
        exteriorColour: source.exteriorColour,
        interiorColour: source.interiorColour,
        horsepower: source.horsepower,
        manufacturerColour: source.manufacturerColour,
        curbWeightLbs: source.curbWeightLbs,
        isDamaged: source.isDamaged,
        ownerCount: source.ownerCount,
        availability: source.availability,
        extendedWarranty: source.extendedWarranty,
        // The video shows that one car, like its VIN; the copy starts without it.
        videoUrl: null,
        salePriceCad: source.salePriceCad,
        msrpCad: source.msrpCad,
        invoicePriceCad: source.invoicePriceCad,
        retailPriceCad: source.retailPriceCad,
        wholesalePriceCad: source.wholesalePriceCad,
        province: source.province,
        city: source.city,
        postalCode: source.postalCode,
        saleChannel: source.saleChannel,
        features: source.features,
        status: 'DRAFT',
        source: 'MANUAL',
        publishedAt: null,
        // Photos point at the same stored files. A file is only deleted once no
        // image row refers to it, so the copy and the original can each drop
        // their photos independently.
        images: {
          create: source.images.map((image) => ({
            url: image.url,
            alt: image.alt,
            position: image.position,
            assetId: image.assetId,
          })),
        },
      },
      select: { id: true },
    });

    await this.vehicles.afterBulkWrite([created.id]);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'vehicle.duplicated',
      entityType: 'Vehicle',
      entityId: created.id,
      metadata: { from: source.id, title: source.title },
    });

    return created;
  }

  private async costTotals(
    vehicleIds: string[],
  ): Promise<Map<string, { total: number; count: number }>> {
    if (vehicleIds.length === 0) return new Map();
    const rows = await this.prisma.vehicleCost.groupBy({
      by: ['vehicleId'],
      where: { vehicleId: { in: vehicleIds } },
      _sum: { amountCents: true },
      _count: { _all: true },
    });
    return new Map(
      rows.map((row) => [
        row.vehicleId,
        { total: row._sum.amountCents ?? 0, count: row._count._all },
      ]),
    );
  }
}

/** "Honda" and "HONDA" from two imports are one make in a filter list. */
function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, value.trim());
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
