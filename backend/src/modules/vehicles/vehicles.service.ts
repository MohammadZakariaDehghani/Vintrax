import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  BulkDeleteVehiclesInput,
  BulkListingStatusInput,
  BulkModerateListingsInput,
  BulkVehicleOutcome,
  BulkVehicleResult,
  CreateVehicleInput,
  ModerateListingInput,
  Paginated,
  ReplaceVehicleHistoryInput,
  SearchVehiclesQuery,
  UpdateListingStatusInput,
  UpdateVehicleInput,
  VehicleDetail,
  VehicleImage,
  VehicleSearchResponse,
  VehicleSummary,
} from '@vintrax/shared';
import { MAX_LISTING_IMAGES, SELLER_STATUS_TRANSITIONS } from '@vintrax/shared';
import { Prisma, type ListingStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { QueueService, QUEUE_NAMES } from '../../common/queue/queue.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService, type StoredLocation } from '../../common/storage/storage.service';
import { SEARCH_PROVIDER, type SearchProvider } from '../../common/search/search.types';
import { isAdmin, type AuthUser } from '../../common/auth/auth-user';
import { VehicleImagesService } from '../vehicle-images/vehicle-images.service';
import {
  toVehicleDetail,
  toVehicleImage,
  toVehicleSummary,
  vehicleImageSelect,
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
    private readonly storage: StorageService,
    @Inject(SEARCH_PROVIDER) private readonly search: SearchProvider,
    private readonly vehicleImages: VehicleImagesService,
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
    // The seller and an admin see the paperwork list; anyone else does not.
    const isOwnerOrAdmin = this.canViewDocuments(row.seller.id, viewer);
    return toVehicleDetail(row, favouritedIds, { includeDocuments: isOwnerOrAdmin });
  }

  /**
   * Streams a vehicle document to someone entitled to read it.
   *
   * The same access rule as the detail response, applied again here: knowing a
   * document id is not authorization, because ids appear in the seller's own
   * responses and could be passed on.
   */
  async openDocument(
    vehicleId: string,
    documentId: string,
    viewer: AuthUser,
  ): Promise<{ location: StoredLocation; filename: string }> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, sellerId: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    if (!this.canViewDocuments(vehicle.sellerId, viewer)) {
      // Indistinguishable from a missing document, so entitlement cannot be
      // probed by asking for ids one at a time.
      throw new NotFoundException('Document not found');
    }

    const document = await this.prisma.vehicleDocument.findFirst({
      where: { id: documentId, vehicleId },
      select: { url: true, filename: true },
    });
    if (!document) throw new NotFoundException('Document not found');

    return {
      location: this.storage.resolveStored(document.url),
      filename: document.filename,
    };
  }

  /**
   * Whether a viewer may read a vehicle's paperwork.
   *
   * The seller who uploaded it, and an administrator. Nobody else, including
   * signed-in browsers of the public listing — a buyer who needs the title or
   * bill of sale gets it from the seller directly, the same way they arrange
   * payment and pickup.
   */
  private canViewDocuments(sellerId: string, viewer?: AuthUser): boolean {
    if (!viewer) return false;
    return viewer.id === sellerId || isAdmin(viewer.role);
  }

  async create(input: CreateVehicleInput, user: AuthUser): Promise<VehicleDetail> {
    const { images, documents, ...fields } = input;
    const assetIds = await this.vehicleImages.assetIdsFor(
      images.map((image) => image.url),
      { userId: user.id, isAdmin: isAdmin(user.role) },
    );

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
        // A new listing is never born published — the create schema does not
        // accept ACTIVE, so publication always comes later, from moderation.
        publishedAt: null,
        images: {
          create: images.map((image, position) => ({
            url: image.url,
            alt: image.alt ?? null,
            position,
            assetId: assetIds.get(image.url) ?? null,
          })),
        },
        documents: {
          create: documents.map((document) => ({
            type: document.type,
            url: document.url,
            filename: document.filename,
            sizeBytes: document.sizeBytes ?? null,
            issuedOn: asStoredDate(document.issuedOn),
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
    const data = fields;

    // The photos this listing used before the save, so any the save drops can
    // have their files removed once it has committed.
    const previousAssetIds = images ? await this.assetIdsOn(id) : [];
    const assetIds = images
      ? await this.vehicleImages.assetIdsFor(
          images.map((image) => image.url),
          { userId: user.id, isAdmin: isAdmin(user.role), vehicleId: id },
        )
      : new Map<string, string>();

    // A vehicle under an active auction cannot have its commercial terms moved
    // out from under the bidders.
    if (existing.status === 'IN_AUCTION') {
      const changesTerms = fields.priceCad !== undefined || fields.reservePriceCad !== undefined;
      if (changesTerms && !isAdmin(user.role)) {
        throw new BadRequestException(
          'This vehicle is in a live auction. Cancel the auction before changing its price.',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // `fields` cannot carry `status` — updateVehicleSchema omits it, so a
      // seller cannot publish their own listing through this path.
      await tx.vehicle.update({ where: { id }, data });

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
              assetId: assetIds.get(image.url) ?? null,
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
              issuedOn: asStoredDate(document.issuedOn),
            })),
          });
        }
      }
    });

    await this.vehicleImages.releaseUnused(previousAssetIds);
    await this.afterWrite(id);

    return this.findById(id, user);
  }

  /**
   * Moves a listing between the statuses its seller owns.
   *
   * Publication is not among them. `SELLER_STATUS_TRANSITIONS` is the whole
   * rule: a seller can submit for review, withdraw, archive, re-draft and mark
   * a vehicle sold, and an administrator reaches `ACTIVE` through moderation.
   * Admins are exempt from the table so support can correct a stuck listing —
   * but not from the auction guard below, which protects a live auction rather
   * than the workflow.
   */
  async setStatus(
    id: string,
    input: UpdateListingStatusInput,
    user: AuthUser,
  ): Promise<VehicleDetail> {
    const existing = await this.requireOwnedVehicle(id, user);
    const next = input.status;

    if (!isAdmin(user.role)) {
      const allowed = SELLER_STATUS_TRANSITIONS[existing.status];
      if (!allowed.includes(next)) {
        throw new BadRequestException(
          allowed.length === 0
            ? `A vehicle that is ${existing.status.toLowerCase().replace('_', ' ')} cannot have its status changed here.`
            : `A ${existing.status} listing can only move to ${allowed.join(' or ')}.`,
        );
      }
    }

    if (next === 'SOLD') {
      // Marking a vehicle sold while people are bidding on it would end the
      // auction by relabelling its subject. Cancel the auction instead.
      const auction = await this.prisma.auction.findFirst({
        where: { vehicleId: id, status: { in: ['SCHEDULED', 'LIVE'] } },
        select: { id: true },
      });
      if (auction) {
        throw new BadRequestException(
          'This vehicle is in an auction. Cancel the auction before marking it sold.',
        );
      }
    }

    await this.prisma.vehicle.update({
      where: { id },
      data: {
        status: next,
        // Returning to draft un-publishes, so "newest" keeps reflecting real
        // publication rather than the first time the listing was written.
        ...(next === 'DRAFT' ? { publishedAt: null } : {}),
        // Time-to-sale reporting reads soldAt, so it has to follow the status
        // in both directions or a reopened listing skews the average.
        ...(next === 'SOLD' ? { soldAt: new Date() } : {}),
        ...(existing.status === 'SOLD' && next !== 'SOLD' ? { soldAt: null } : {}),
      },
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'vehicle.status_changed',
      entityType: 'Vehicle',
      entityId: id,
      metadata: { from: existing.status, to: next },
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
      throw new BadRequestException('Cancel the auction on this vehicle before deleting it');
    }

    if (vehicle.status === 'SOLD') {
      throw new BadRequestException(
        'This vehicle is marked sold and cannot be deleted. Archive it instead.',
      );
    }

    const assetIds = await this.assetIdsOn(id);
    await this.prisma.vehicle.delete({ where: { id } });
    // After the delete, so the rows that pointed at these files are gone
    // before the files are.
    await this.vehicleImages.releaseUnused(assetIds);
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
  /**
   * The caller's own vehicles, optionally filtered by status and by keyword.
   *
   * The keyword search is a plain `contains` across the handful of fields a
   * dealer actually searches by — not the public full-text index, which only
   * covers published listings and would therefore never find the draft they are
   * looking for. Inventory is a few hundred rows per seller, so this is the
   * right size of tool.
   *
   * `sellerId` stays first in the filter and is never derived from the query, so
   * a search term cannot widen the result past the caller's own inventory.
   * Terms are ANDed: typing "2015 hyundai" should narrow, not widen.
   */
  async listMine(
    user: AuthUser,
    page: number,
    pageSize: number,
    status?: ListingStatus,
    q?: string,
  ): Promise<Paginated<VehicleSummary>> {
    const terms = (q ?? '')
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 6);

    const where: Prisma.VehicleWhereInput = {
      sellerId: user.id,
      ...(status ? { status } : {}),
      ...(terms.length > 0
        ? {
            AND: terms.map((term) => ({
              OR: [
                { title: { contains: term, mode: 'insensitive' as const } },
                { make: { contains: term, mode: 'insensitive' as const } },
                { model: { contains: term, mode: 'insensitive' as const } },
                { trim: { contains: term, mode: 'insensitive' as const } },
                { vin: { contains: term, mode: 'insensitive' as const } },
                { stockNumber: { contains: term, mode: 'insensitive' as const } },
                { city: { contains: term, mode: 'insensitive' as const } },
                // A year typed as a word is the commonest search of all.
                ...(/^\d{4}$/.test(term) ? [{ year: Number(term) }] : []),
              ],
            })),
          }
        : {}),
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

  /**
   * Replaces a vehicle's history timeline.
   *
   * Whole-set replacement, matching how images and documents already work here:
   * the client holds the ordered list and order is part of the data, so a
   * per-entry API would need a reorder endpoint as well and two ways to get the
   * order wrong.
   *
   * `requireOwnedVehicle` is what scopes it. A timeline is shown to buyers, so
   * the ability to write one is the ability to make a claim about a car — it
   * belongs to whoever owns the listing, and to nobody else.
   */
  async replaceHistory(
    id: string,
    input: ReplaceVehicleHistoryInput,
    user: AuthUser,
  ): Promise<VehicleDetail> {
    await this.requireOwnedVehicle(id, user);

    await this.prisma.$transaction(async (tx) => {
      await tx.vehicleHistoryEvent.deleteMany({ where: { vehicleId: id } });
      if (input.events.length > 0) {
        await tx.vehicleHistoryEvent.createMany({
          data: input.events.map((event, position) => ({
            vehicleId: id,
            kind: event.kind,
            // A `@db.Date` column: parsed at UTC midnight so the calendar date
            // that was typed is the calendar date that is stored, whatever the
            // server's timezone.
            occurredOn: event.occurredOn ? new Date(`${event.occurredOn}T00:00:00Z`) : null,
            label: event.label,
            detail: event.detail ?? null,
            position,
          })),
        });
      }
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'vehicle.history_updated',
      entityType: 'Vehicle',
      entityId: id,
      metadata: { events: input.events.length },
    });

    return this.findById(id, user);
  }

  /**
   * The same status change, applied to many vehicles.
   *
   * Each id goes through `setStatus`, one at a time. That is deliberate and it
   * is the whole design: every rule that protects a single listing — the
   * transition table, the live-auction guard, ownership, the audit entry — is
   * enforced because the single-vehicle path is what runs.
   * A bulk endpoint that wrote `updateMany` would be a second implementation of
   * those rules, and the second one is always the one that forgets the auction.
   *
   * Partial success is the expected outcome rather than an error. A dealer who
   * selects everything on the page will include something already in review,
   * and one refusal must not undo the other nineteen, so each id carries its
   * own answer back.
   */
  async setStatusMany(input: BulkListingStatusInput, user: AuthUser): Promise<BulkVehicleResult> {
    const titles = await this.titlesFor(input.ids);

    const outcomes: BulkVehicleOutcome[] = [];
    for (const id of input.ids) {
      const title = titles.get(id) ?? null;
      try {
        await this.setStatus(id, { status: input.status }, user);
        await this.recordBulkAudit('vehicle.status_changed', id, user, {
          status: input.status,
          bulk: true,
        });
        outcomes.push({ id, ok: true, title, error: null });
      } catch (error) {
        outcomes.push({ id, ok: false, title, error: reasonFor(error) });
      }
    }

    return summariseBulk(outcomes);
  }

  /**
   * Deleting many vehicles at once.
   *
   * Every id goes through `remove`, which is what keeps the two guards that
   * matter: a vehicle under a live auction cannot be deleted out from under its
   * bidders, and a vehicle marked sold cannot be deleted at all — it is
   * archived instead, so a completed sale stays in the record. A bulk
   * `deleteMany` would skip both, on the one action that cannot be undone.
   *
   * Ownership comes from `remove` too: a seller reaches only their own
   * vehicles, an administrator reaches any. So this endpoint grants nobody
   * anything they did not already have one vehicle at a time.
   */
  async removeMany(input: BulkDeleteVehiclesInput, user: AuthUser): Promise<BulkVehicleResult> {
    const titles = await this.titlesFor(input.ids);
    const outcomes: BulkVehicleOutcome[] = [];

    for (const id of input.ids) {
      const title = titles.get(id) ?? null;
      try {
        // `remove` writes its own audit entry, unlike the status and moderation
        // paths where the controller decorator did it. No second entry here.
        await this.remove(id, user);
        outcomes.push({ id, ok: true, title, error: null });
      } catch (error) {
        outcomes.push({ id, ok: false, title, error: reasonFor(error) });
      }
    }

    this.logger.warn(
      `${user.email} deleted ${outcomes.filter((outcome) => outcome.ok).length} of ${input.ids.length} vehicles in one action`,
    );

    return summariseBulk(outcomes);
  }

  /** The same moderation decision, applied to many vehicles. See `setStatusMany`. */
  async moderateMany(
    input: BulkModerateListingsInput,
    actor: AuthUser,
  ): Promise<BulkVehicleResult> {
    const titles = await this.titlesFor(input.ids);

    const outcomes: BulkVehicleOutcome[] = [];
    for (const id of input.ids) {
      const title = titles.get(id) ?? null;
      try {
        await this.moderate(
          id,
          { approved: input.approved, ...(input.reason ? { reason: input.reason } : {}) },
          actor,
        );
        await this.recordBulkAudit('vehicle.moderated', id, actor, {
          approved: input.approved,
          reason: input.reason ?? null,
          bulk: true,
        });
        outcomes.push({ id, ok: true, title, error: null });
      } catch (error) {
        outcomes.push({ id, ok: false, title, error: reasonFor(error) });
      }
    }

    return summariseBulk(outcomes);
  }

  /**
   * Titles for a bulk action's ids, so an outcome can name the vehicle.
   *
   * Read before the work starts, because a deletion removes the row that would
   * have answered the question afterwards.
   */
  private async titlesFor(ids: readonly string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.vehicle.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, title: true },
    });
    return new Map(rows.map((vehicle) => [vehicle.id, vehicle.title]));
  }

  /**
   * One audit entry per vehicle a bulk action actually changed.
   *
   * Written here rather than by `@Audit` on the controller. That decorator
   * takes its entity id from `request.params.id`, and a bulk route has none —
   * it would file a single entry with a null id, which answers "someone did
   * something" and not "who published which twenty listings". The bulk routes
   * therefore carry no `@Audit`, so this is the only entry and there is no
   * duplicate, matching how `UsersService.setPassword` handles the same
   * problem.
   *
   * Only successes are recorded, as the interceptor does: a refusal belongs in
   * the log, not in the record of what happened.
   */
  private async recordBulkAudit(
    action: string,
    vehicleId: string,
    actor: AuthUser,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action,
      entityType: 'Vehicle',
      entityId: vehicleId,
      metadata,
    });
  }

  /** Admin moderation of a vehicle awaiting review. */
  async moderate(id: string, input: ModerateListingInput, actor: AuthUser): Promise<VehicleDetail> {
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

  /**
   * Adds one photo to the end of a listing: validated and processed exactly
   * like `POST /uploads/images`, then attached in the same request. For
   * clients that manage photos one at a time rather than saving the whole
   * listing.
   */
  async addImage(id: string, file: Buffer, user: AuthUser): Promise<VehicleImage> {
    await this.requireOwnedVehicle(id, user);
    const count = await this.prisma.vehicleImage.count({ where: { vehicleId: id } });
    if (count >= MAX_LISTING_IMAGES) {
      throw new BadRequestException(`A listing can have at most ${MAX_LISTING_IMAGES} photos.`);
    }

    const uploaded = await this.vehicleImages.ingest(file, {
      uploadedById: user.id,
      vehicleId: id,
    });
    const image = await this.prisma.vehicleImage.create({
      data: { vehicleId: id, url: uploaded.url, position: count, assetId: uploaded.id },
      select: vehicleImageSelect,
    });

    await this.afterWrite(id);
    return toVehicleImage(image);
  }

  /**
   * Swaps the file behind one photo, keeping its place in the listing. The
   * new photo is fully processed and stored before the row moves to it, and
   * the old files are removed only after — there is no moment at which the
   * listing points at a file that is not there.
   */
  async replaceImage(
    id: string,
    imageId: string,
    file: Buffer,
    user: AuthUser,
  ): Promise<VehicleImage> {
    await this.requireOwnedVehicle(id, user);
    const existing = await this.prisma.vehicleImage.findFirst({
      where: { id: imageId, vehicleId: id },
      select: { assetId: true },
    });
    if (!existing) throw new NotFoundException('Photo not found');

    const uploaded = await this.vehicleImages.ingest(file, {
      uploadedById: user.id,
      vehicleId: id,
    });
    const image = await this.prisma.vehicleImage.update({
      where: { id: imageId },
      // A replaced feed photo becomes the dealer's own: the importer keys on
      // `sourceUrl` and would otherwise swap it back on the next run.
      data: { url: uploaded.url, assetId: uploaded.id, sourceUrl: null, sourceUpdatedAt: null },
      select: vehicleImageSelect,
    });

    if (existing.assetId) await this.vehicleImages.releaseUnused([existing.assetId]);
    await this.afterWrite(id);
    return toVehicleImage(image);
  }

  /**
   * Removes one photo and its files. Idempotent: a photo that is already
   * gone is not an error — the listing is in the state the caller asked for.
   */
  async removeImage(id: string, imageId: string, user: AuthUser): Promise<void> {
    await this.requireOwnedVehicle(id, user);
    const existing = await this.prisma.vehicleImage.findFirst({
      where: { id: imageId, vehicleId: id },
      select: { position: true, assetId: true },
    });
    if (!existing) return;

    await this.prisma.$transaction([
      this.prisma.vehicleImage.delete({ where: { id: imageId } }),
      // Close the gap, so position 0 is still the primary photo.
      this.prisma.vehicleImage.updateMany({
        where: { vehicleId: id, position: { gt: existing.position } },
        data: { position: { decrement: 1 } },
      }),
    ]);

    if (existing.assetId) await this.vehicleImages.releaseUnused([existing.assetId]);
    await this.afterWrite(id);
  }

  /** Processed photos currently on a listing. */
  private async assetIdsOn(vehicleId: string): Promise<string[]> {
    const rows = await this.prisma.vehicleImage.findMany({
      where: { vehicleId, assetId: { not: null } },
      select: { assetId: true },
    });
    return rows.map((row) => row.assetId!);
  }

  private async requireOwnedVehicle(
    id: string,
    user: AuthUser,
  ): Promise<{
    id: string;
    sellerId: string;
    title: string;
    status: ListingStatus;
    publishedAt: Date | null;
  }> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      select: {
        id: true,
        sellerId: true,
        title: true,
        status: true,
        publishedAt: true,
      },
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

  /**
   * Invalidates caches and reindexes after a bulk write.
   *
   * Public because the CSV importer writes vehicles without going through
   * `create`/`update`, and a listing that is in the database but not in the
   * search index is invisible to buyers — which is the whole point of listing
   * it. One cache drop for the batch, one index job per vehicle.
   */
  async afterBulkWrite(vehicleIds: readonly string[]): Promise<void> {
    if (vehicleIds.length === 0) return;

    // Bounded, and failure is logged rather than thrown.
    //
    // This runs after a bulk import has already committed. If the queue is
    // unreachable, the vehicles are in the database and the dealer must be told
    // so — a request that hangs instead leaves them believing the import failed,
    // and their retry then reports every row as unchanged, which looks like the
    // importer silently did nothing. A missing index entry is recoverable by a
    // reindex; a dealer who no longer trusts the importer is not.
    //
    // Note this does not protect the single-vehicle path, which awaits the same
    // enqueue unguarded in `afterWrite`. That is existing behaviour and is left
    // alone here rather than changed as a side effect of an import feature.
    const REINDEX_BUDGET_MS = 5_000;

    try {
      await Promise.race([
        (async () => {
          await this.redis.delByPattern('vehicles:search:*');
          await Promise.all(
            vehicleIds.map((vehicleId) =>
              this.queue.enqueue(
                QUEUE_NAMES.search,
                'index-vehicle',
                { vehicleId },
                { jobId: `search-${vehicleId}-${Date.now()}` },
              ),
            ),
          );
        })(),
        new Promise((_resolve, reject) =>
          setTimeout(
            () => reject(new Error(`search reindex did not respond in ${REINDEX_BUDGET_MS}ms`)),
            REINDEX_BUDGET_MS,
          ).unref(),
        ),
      ]);
    } catch (error) {
      this.logger.error(
        `Wrote ${vehicleIds.length} vehicles but could not queue them for search indexing: ${String(error)}. They are listed; run a reindex to make them searchable.`,
      );
    }
  }

  /**
   * Derives a URL-safe slug, suffixing on collision.
   *
   * `client` exists so a caller inside an interactive transaction can pass its
   * transaction client. Querying `this.prisma` from inside one waits on a
   * connection that transaction is holding, which deadlocks until the
   * transaction times out — and it would also miss rows inserted earlier in the
   * same transaction, handing two of them the same slug.
   */
  async uniqueSlug(
    year: number,
    make: string,
    model: string,
    trim?: string,
    client: Pick<PrismaService, 'vehicle'> = this.prisma,
  ): Promise<string> {
    const base =
      `${year}-${make}-${model}${trim ? `-${trim}` : ''}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'vehicle';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      const taken = await client.vehicle.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return `${base}-${randomBytes(4).toString('hex')}`;
  }
}

/**
 * The message a bulk outcome carries for one refused vehicle.
 *
 * Only the text of an exception the application raised deliberately. Anything
 * else — a driver error, a bug — is reported as a generic failure rather than
 * relayed, because a Prisma message names columns and constraints and this
 * string is shown to a dealer.
 */
function reasonFor(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
    return error.message;
  }
  return 'Could not be changed.';
}

function summariseBulk(outcomes: BulkVehicleOutcome[]): BulkVehicleResult {
  return {
    succeeded: outcomes.filter((outcome) => outcome.ok).length,
    failed: outcomes.filter((outcome) => !outcome.ok).length,
    outcomes,
  };
}

/**
 * A `YYYY-MM-DD` input as the value a `@db.Date` column should hold.
 *
 * Parsed at UTC midnight so the calendar date that was typed is the calendar
 * date that is stored, whatever timezone the server happens to run in.
 */
function asStoredDate(value: string | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00Z`) : null;
}
