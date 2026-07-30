import { Injectable, NotFoundException } from '@nestjs/common';
import type { ListingSummary, Paginated } from '@atlas/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { listingSummarySelect, toListingSummary } from '../listings/listings.mapper';

@Injectable()
export class FavouritesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent: favouriting an already-favourited listing is a no-op. */
  async add(listingId: string, user: AuthUser): Promise<void> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, status: true },
    });
    if (!listing || listing.status === 'DRAFT' || listing.status === 'ARCHIVED') {
      throw new NotFoundException('Listing not found');
    }

    await this.prisma.favourite.upsert({
      where: { userId_listingId: { userId: user.id, listingId } },
      update: {},
      create: { userId: user.id, listingId },
    });
  }

  /** Idempotent: removing a listing that was never favourited succeeds. */
  async remove(listingId: string, user: AuthUser): Promise<void> {
    await this.prisma.favourite.deleteMany({ where: { userId: user.id, listingId } });
  }

  async list(user: AuthUser, page: number, pageSize: number): Promise<Paginated<ListingSummary>> {
    const where = { userId: user.id };

    const [total, rows] = await Promise.all([
      this.prisma.favourite.count({ where }),
      this.prisma.favourite.findMany({
        where,
        select: { listing: { select: listingSummarySelect } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // Everything in this collection is favourited by definition.
    const favouritedIds = new Set(rows.map((row) => row.listing.id));

    return {
      items: rows.map((row) => toListingSummary(row.listing, favouritedIds)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}
