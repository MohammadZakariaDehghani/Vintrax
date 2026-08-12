import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  BODY_TYPES,
  DRIVETRAINS,
  FUEL_TYPES,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
  type CreateListingInput,
  type ListingDetail,
  type ListingSearchResponse,
  type ListingSummary,
  type Paginated,
  type SearchListingsQuery,
  type UpdateListingInput,
} from '@atlas/shared';
import { Prisma, type ListingStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../../common/auth/auth-user';
import {
  listingDetailSelect,
  listingSummarySelect,
  toListingDetail,
  toListingSummary,
} from './listings.mapper';

/** Statuses a listing must hold to be visible to someone other than its seller. */
const PUBLICLY_VISIBLE: ListingStatus[] = ['ACTIVE', 'SOLD'];

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async search(query: SearchListingsQuery, viewer?: AuthUser): Promise<ListingSearchResponse> {
    const where = this.buildSearchWhere(query);
    const skip = (query.page - 1) * query.pageSize;

    const [total, rows] = await Promise.all([
      this.prisma.listing.count({ where }),
      this.prisma.listing.findMany({
        where,
        select: listingSummarySelect,
        orderBy: this.buildOrderBy(query.sort),
        skip,
        take: query.pageSize,
      }),
    ]);

    const favouritedIds = await this.favouritedIds(
      viewer?.id,
      rows.map((row) => row.id),
    );

    return {
      items: rows.map((row) => toListingSummary(row, favouritedIds)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      facets: await this.buildFacets(where),
    };
  }

  async findById(id: string, viewer?: AuthUser): Promise<ListingDetail> {
    const row = await this.prisma.listing.findUnique({
      where: { id },
      select: listingDetailSelect,
    });
    if (!row) throw new NotFoundException('Listing not found');

    const isOwner = viewer?.id === row.seller.id;
    const isAdmin = viewer?.role === 'ADMIN';
    if (!PUBLICLY_VISIBLE.includes(row.status) && !isOwner && !isAdmin) {
      // Unpublished listings are indistinguishable from missing ones.
      throw new NotFoundException('Listing not found');
    }

    // A seller previewing their own listing should not inflate its view count.
    if (!isOwner && row.status === 'ACTIVE') {
      this.prisma.listing
        .update({ where: { id }, data: { viewCount: { increment: 1 } } })
        .catch((error: unknown) => {
          // A failed counter must never fail the page load.
          this.logger.warn(`Failed to increment view count for listing ${id}: ${String(error)}`);
        });
    }

    const favouritedIds = await this.favouritedIds(viewer?.id, [row.id]);
    return toListingDetail(row, favouritedIds);
  }

  async create(input: CreateListingInput, user: AuthUser): Promise<ListingDetail> {
    const { images, ...fields } = input;

    const listing = await this.prisma.listing.create({
      data: {
        ...fields,
        trim: fields.trim ?? null,
        exteriorColour: fields.exteriorColour ?? null,
        vin: fields.vin ?? null,
        sellerId: user.id,
        publishedAt: fields.status === 'ACTIVE' ? new Date() : null,
        images: {
          create: images.map((image, position) => ({
            url: image.url,
            alt: image.alt ?? null,
            position,
          })),
        },
      },
      select: { id: true },
    });

    return this.findById(listing.id, user);
  }

  async update(id: string, input: UpdateListingInput, user: AuthUser): Promise<ListingDetail> {
    const existing = await this.requireOwnedListing(id, user);
    const { images, ...fields } = input;

    await this.prisma.$transaction(async (tx) => {
      await tx.listing.update({
        where: { id },
        data: {
          ...fields,
          // Stamp publishedAt the first time a listing goes live, and clear it if
          // it returns to draft, so "newest" ordering reflects real publication.
          ...(fields.status === 'ACTIVE' && !existing.publishedAt ? { publishedAt: new Date() } : {}),
          ...(fields.status === 'DRAFT' ? { publishedAt: null } : {}),
        },
      });

      // Images are replaced wholesale — the client always sends the full ordered set.
      if (images) {
        await tx.listingImage.deleteMany({ where: { listingId: id } });
        if (images.length) {
          await tx.listingImage.createMany({
            data: images.map((image, position) => ({
              listingId: id,
              url: image.url,
              alt: image.alt ?? null,
              position,
            })),
          });
        }
      }
    });

    return this.findById(id, user);
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    await this.requireOwnedListing(id, user);
    await this.prisma.listing.delete({ where: { id } });
  }

  /** Every listing belonging to the caller, including drafts and archived ones. */
  async listMine(
    user: AuthUser,
    page: number,
    pageSize: number,
    status?: ListingStatus,
  ): Promise<Paginated<ListingSummary>> {
    const where: Prisma.ListingWhereInput = {
      sellerId: user.id,
      ...(status ? { status } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.listing.count({ where }),
      this.prisma.listing.findMany({
        where,
        select: listingSummarySelect,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const favouritedIds = await this.favouritedIds(
      user.id,
      rows.map((row) => row.id),
    );

    return {
      items: rows.map((row) => toListingSummary(row, favouritedIds)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  private async requireOwnedListing(
    id: string,
    user: AuthUser,
  ): Promise<{ id: string; sellerId: string; publishedAt: Date | null }> {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, sellerId: true, publishedAt: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.sellerId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('You do not have permission to modify this listing');
    }
    return listing;
  }

  /** Which of `listingIds` the viewer has favourited. Empty when anonymous. */
  private async favouritedIds(
    viewerId: string | undefined,
    listingIds: string[],
  ): Promise<ReadonlySet<string>> {
    if (!viewerId || listingIds.length === 0) return new Set();
    const rows = await this.prisma.favourite.findMany({
      where: { userId: viewerId, listingId: { in: listingIds } },
      select: { listingId: true },
    });
    return new Set(rows.map((row) => row.listingId));
  }

  private buildSearchWhere(query: SearchListingsQuery): Prisma.ListingWhereInput {
    const where: Prisma.ListingWhereInput = { status: 'ACTIVE' };
    const and: Prisma.ListingWhereInput[] = [];

    if (query.q) {
      // Every term must appear somewhere on the listing, but each term may match
      // any field — so "blue rav4" finds a blue RAV4 rather than nothing.
      for (const term of query.q.split(/\s+/).filter(Boolean)) {
        and.push({
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { make: { contains: term, mode: 'insensitive' } },
            { model: { contains: term, mode: 'insensitive' } },
            { trim: { contains: term, mode: 'insensitive' } },
            { exteriorColour: { contains: term, mode: 'insensitive' } },
            // Substring matching on free prose is noisy for very short terms —
            // "ev" would otherwise hit "Chevrolet", "seven" and "previous". Real
            // word-boundary matching needs a tsvector column (Phase 2).
            ...(term.length >= 3
              ? [{ description: { contains: term, mode: 'insensitive' as const } }]
              : []),
            // Categories live in enum columns, not text, so a search for
            // "awd suv" would otherwise match nothing at all.
            ...this.enumMatchesForTerm(term),
          ],
        });
      }
    }

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

    if (query.sellerType) where.seller = { role: query.sellerType };

    if (and.length) where.AND = and;
    return where;
  }

  /**
   * Maps a free-text term onto the enum columns it could plausibly mean, so
   * category words typed into the search box behave like the filter chips do.
   * Accepts the common shorthands buyers actually type ("4x4", "ev", "hybrid").
   */
  private enumMatchesForTerm(term: string): Prisma.ListingWhereInput[] {
    const key = term.toUpperCase().replace(/[\s-]/g, '_');
    const matches: Prisma.ListingWhereInput[] = [];

    const aliases: Record<string, Prisma.ListingWhereInput> = {
      '4X4': { drivetrain: 'FOUR_WHEEL_DRIVE' },
      '4WD': { drivetrain: 'FOUR_WHEEL_DRIVE' },
      EV: { fuelType: 'ELECTRIC' },
      PHEV: { fuelType: 'PLUG_IN_HYBRID' },
      CPO: { condition: 'CERTIFIED_PRE_OWNED' },
      AUTO: { transmission: 'AUTOMATIC' },
      PICKUP: { bodyType: 'TRUCK' },
    };

    const alias = aliases[key];
    if (alias) matches.push(alias);

    if ((BODY_TYPES as readonly string[]).includes(key)) {
      matches.push({ bodyType: key as (typeof BODY_TYPES)[number] });
    }
    if ((FUEL_TYPES as readonly string[]).includes(key)) {
      matches.push({ fuelType: key as (typeof FUEL_TYPES)[number] });
    }
    if ((DRIVETRAINS as readonly string[]).includes(key)) {
      matches.push({ drivetrain: key as (typeof DRIVETRAINS)[number] });
    }
    if ((TRANSMISSIONS as readonly string[]).includes(key)) {
      matches.push({ transmission: key as (typeof TRANSMISSIONS)[number] });
    }
    if ((VEHICLE_CONDITIONS as readonly string[]).includes(key)) {
      matches.push({ condition: key as (typeof VEHICLE_CONDITIONS)[number] });
    }

    return matches;
  }

  private buildOrderBy(sort: SearchListingsQuery['sort']): Prisma.ListingOrderByWithRelationInput[] {
    switch (sort) {
      case 'PRICE_ASC':
        return [{ priceCad: 'asc' }, { id: 'asc' }];
      case 'PRICE_DESC':
        return [{ priceCad: 'desc' }, { id: 'asc' }];
      case 'MILEAGE_ASC':
        return [{ mileageKm: 'asc' }, { id: 'asc' }];
      case 'YEAR_DESC':
        return [{ year: 'desc' }, { id: 'asc' }];
      case 'NEWEST':
      case 'RELEVANCE':
      default:
        // RELEVANCE is currently recency. Real scoring needs a tsvector column and
        // ts_rank, which is a Phase 2 change rather than a rename here.
        // A tiebreaker on id keeps pagination stable when timestamps collide.
        return [{ publishedAt: 'desc' }, { id: 'asc' }];
    }
  }

  private async buildFacets(
    where: Prisma.ListingWhereInput,
  ): Promise<ListingSearchResponse['facets']> {
    const [makes, bodyTypes, provinces] = await Promise.all([
      this.prisma.listing.groupBy({
        by: ['make'],
        where,
        _count: { _all: true },
        orderBy: { _count: { make: 'desc' } },
        take: 12,
      }),
      this.prisma.listing.groupBy({ by: ['bodyType'], where, _count: { _all: true } }),
      this.prisma.listing.groupBy({ by: ['province'], where, _count: { _all: true } }),
    ]);

    return {
      makes: makes.map((row) => ({ value: row.make, count: row._count._all })),
      bodyTypes: bodyTypes
        .map((row) => ({ value: row.bodyType, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
      provinces: provinces
        .map((row) => ({ value: row.province, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
