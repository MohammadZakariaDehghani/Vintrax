import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateVehicleInput,
  ModerateListingInput,
  Paginated,
  SearchVehiclesQuery,
  UpdateVehicleInput,
  VehicleDetail,
  VehicleSearchResponse,
  VehicleSummary,
} from '@atlas/shared';
import { Prisma, type ListingStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { QueueService, QUEUE_NAMES } from '../../common/queue/queue.service';
import { AuditService } from '../../common/audit/audit.service';
import { SEARCH_PROVIDER, type SearchProvider } from '../../common/search/search.types';
import { isAdmin, type AuthUser } from '../../common/auth/auth-user';
import {
  toVehicleDetail,
  toVehicleSummary,
  vehicleDetailSelect,
  vehicleSummarySelect,
} from './vehicles.mapper';

/** Statuses a vehicle must hold to be visible to someone other than its seller. */
const PUBLICLY_VISIBLE: ListingStatus[] = ['ACTIVE', 'IN_AUCTION', 'SOLD'];

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    @Inject(SEARCH_PROVIDER) private readonly search: SearchProvider,
  ) {}

  searchVehicles(query: SearchVehiclesQuery, viewer?: AuthUser): Promise<VehicleSearchResponse> {
    return this.search.search(query, viewer?.id);
  }

  async findById(idOrSlug: string, viewer?: AuthUser): Promise<VehicleDetail> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

    const row = await this.prisma.vehicle.findUnique({
      where: isUuid ? { id: idOrSlug } : { slug: idOrSlug },
      select: vehicleDetailSelect,
    });
    if (!row) throw new NotFoundException('Vehicle not found');

    const isOwner = viewer?.id === row.seller.id;
    const viewerIsAdmin = viewer ? isAdmin(viewer.role) : false;

    if (!PUBLICLY_VISIBLE.includes(row.status) && !isOwner && !viewerIsAdmin) {
      // Unpublished vehicles are indistinguishable from missing ones, so their
      // existence cannot be confirmed by probing ids.
      throw new NotFoundException('Vehicle not found');
    }

    // A seller previewing their own listing should not inflate its view count.
    if (!isOwner && (row.status === 'ACTIVE' || row.status === 'IN_AUCTION')) {
      this.prisma.vehicle
        .update({ where: { id: row.id }, data: { viewCount: { increment: 1 } } })
        .catch((error: unknown) => {
          // A failed counter must never fail the page load.
          this.logger.warn(`Failed to increment view count for ${row.id}: ${String(error)}`);
        });
    }

    const favouritedIds = await this.favouritedIds(viewer?.id, [row.id]);
    return toVehicleDetail(row, favouritedIds);
  }

  async create(input: CreateVehicleInput, user: AuthUser): Promise<VehicleDetail> {
    const { images, documents, ...fields } = input;

    const vehicle = await this.prisma.vehicle.create({
      data: {
        ...fields,
        slug: await this.uniqueSlug(fields.year, fields.make, fields.model, fields.trim),
        trim: fields.trim ?? null,
        vin: fields.vin ?? null,
        engine: fields.engine ?? null,
        exteriorColour: fields.exteriorColour ?? null,
        interiorColour: fields.interiorColour ?? null,
        postalCode: fields.postalCode ?? null,
        reservePriceCad: fields.reservePriceCad ?? null,
        sellerId: user.id,
        publishedAt: fields.status === 'ACTIVE' ? new Date() : null,
        images: {
          create: images.map((image, position) => ({
            url: image.url,
            alt: image.alt ?? null,
            position,
          })),
        },
        documents: {
          create: documents.map((document) => ({
            type: document.type,
            url: document.url,
            filename: document.filename,
            sizeBytes: document.sizeBytes ?? null,
          })),
        },
      },
      select: { id: true },
    });

    await this.afterWrite(vehicle.id);
    return this.findById(vehicle.id, user);
  }

  async update(id: string, input: UpdateVehicleInput, user: AuthUser): Promise<VehicleDetail> {
    const existing = await this.requireOwnedVehicle(id, user);
    const { images, documents, ...fields } = input;

    // A vehicle under an active auction cannot have its commercial terms moved
    // out from under the bidders.
    if (existing.status === 'IN_AUCTION') {
      const changesTerms =
        fields.priceCad !== undefined ||
        fields.reservePriceCad !== undefined ||
        fields.status !== undefined;
      if (changesTerms && !isAdmin(user.role)) {
        throw new BadRequestException(
          'This vehicle is in a live auction. Cancel the auction before changing its price or status.',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.vehicle.update({
        where: { id },
        data: {
          ...fields,
          // Stamp publishedAt the first time a vehicle goes live, and clear it
          // if it returns to draft, so "newest" reflects real publication.
          ...(fields.status === 'ACTIVE' && !existing.publishedAt
            ? { publishedAt: new Date() }
            : {}),
          ...(fields.status === 'DRAFT' ? { publishedAt: null } : {}),
          ...(fields.status === 'SOLD' ? { soldAt: new Date() } : {}),
        },
      });

      // Images and documents are replaced wholesale — the client always sends
      // the full ordered set.
      if (images) {
        await tx.vehicleImage.deleteMany({ where: { vehicleId: id } });
        if (images.length) {
          await tx.vehicleImage.createMany({
            data: images.map((image, position) => ({
              vehicleId: id,
              url: image.url,
              alt: image.alt ?? null,
              position,
            })),
          });
        }
      }

      if (documents) {
        await tx.vehicleDocument.deleteMany({ where: { vehicleId: id } });
        if (documents.length) {
          await tx.vehicleDocument.createMany({
            data: documents.map((document) => ({
              vehicleId: id,
              type: document.type,
              url: document.url,
              filename: document.filename,
              sizeBytes: document.sizeBytes ?? null,
            })),
          });
        }
      }
    });

    await this.afterWrite(id);
    return this.findById(id, user);
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const vehicle = await this.requireOwnedVehicle(id, user);

    // Deleting a vehicle mid-auction would strand bidders and any settlement.
    const liveAuction = await this.prisma.auction.findFirst({
      where: { vehicleId: id, status: { in: ['SCHEDULED', 'LIVE'] } },
      select: { id: true },
    });
    if (liveAuction) {
      throw new BadRequestException(
        'Cancel the auction on this vehicle before deleting it',
      );
    }

    const sold = await this.prisma.transactionRecord.findFirst({
      where: { vehicleId: id, status: { notIn: ['CANCELLED'] } },
      select: { id: true },
    });
    if (sold) {
      throw new BadRequestException(
        'This vehicle has a sales record and cannot be deleted. Archive it instead.',
      );
    }

    await this.prisma.vehicle.delete({ where: { id } });
    await this.afterWrite(id, { removed: true });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'vehicle.deleted',
      entityType: 'Vehicle',
      entityId: id,
      metadata: { title: vehicle.title },
    });
  }

  /** Every vehicle belonging to the caller, including drafts and archived ones. */
  async listMine(
    user: AuthUser,
    page: number,
    pageSize: number,
    status?: ListingStatus,
  ): Promise<Paginated<VehicleSummary>> {
    const where: Prisma.VehicleWhereInput = {
      sellerId: user.id,
      ...(status ? { status } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.findMany({
        where,
        select: vehicleSummarySelect,
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
      items: rows.map((row) => toVehicleSummary(row, favouritedIds)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Admin moderation of a vehicle awaiting review. */
  async moderate(
    id: string,
    input: ModerateListingInput,
    actor: AuthUser,
  ): Promise<VehicleDetail> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      select: { id: true, sellerId: true, title: true, publishedAt: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    await this.prisma.vehicle.update({
      where: { id },
      data: {
        status: input.approved ? 'ACTIVE' : 'DRAFT',
        moderatedAt: new Date(),
        moderationNote: input.reason ?? null,
        ...(input.approved && !vehicle.publishedAt ? { publishedAt: new Date() } : {}),
      },
    });

    await this.queue.enqueue(QUEUE_NAMES.notifications, 'listing-moderated', {
      userId: vehicle.sellerId,
      vehicleId: id,
      vehicleTitle: vehicle.title,
      approved: input.approved,
      reason: input.reason ?? null,
    });

    await this.afterWrite(id);
    return this.findById(id, actor);
  }

  async listPendingReview(page: number, pageSize: number): Promise<Paginated<VehicleSummary>> {
    const where: Prisma.VehicleWhereInput = { status: 'PENDING_REVIEW' };

    const [total, rows] = await Promise.all([
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.findMany({
        where,
        select: vehicleSummarySelect,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => toVehicleSummary(row, new Set())),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Loads a vehicle for internal callers, bypassing visibility rules. */
  async requireVehicle(id: string): Promise<{
    id: string;
    sellerId: string;
    title: string;
    status: ListingStatus;
    priceCad: number;
    reservePriceCad: number | null;
  }> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      select: {
        id: true,
        sellerId: true,
        title: true,
        status: true,
        priceCad: true,
        reservePriceCad: true,
      },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  private async requireOwnedVehicle(
    id: string,
    user: AuthUser,
  ): Promise<{ id: string; sellerId: string; title: string; status: ListingStatus; publishedAt: Date | null }> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      select: { id: true, sellerId: true, title: true, status: true, publishedAt: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (vehicle.sellerId !== user.id && !isAdmin(user.role)) {
      throw new ForbiddenException('You do not have permission to modify this vehicle');
    }
    return vehicle;
  }

  /** Which of `vehicleIds` the viewer has favourited. Empty when anonymous. */
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

  /** Keeps the search index and cached responses in step after a write. */
  private async afterWrite(vehicleId: string, options: { removed?: boolean } = {}): Promise<void> {
    await this.redis.delByPattern('vehicles:search:*');

    await this.queue.enqueue(
      QUEUE_NAMES.search,
      options.removed ? 'remove-vehicle' : 'index-vehicle',
      { vehicleId },
      { jobId: `search-${vehicleId}-${Date.now()}` },
    );
  }

  /** Derives a URL-safe slug, suffixing on collision. */
  private async uniqueSlug(
    year: number,
    make: string,
    model: string,
    trim?: string,
  ): Promise<string> {
    const base =
      `${year}-${make}-${model}${trim ? `-${trim}` : ''}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'vehicle';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      const taken = await this.prisma.vehicle.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return `${base}-${randomBytes(4).toString('hex')}`;
  }
}
