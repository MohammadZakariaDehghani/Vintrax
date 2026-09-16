import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  INVENTORY_CSV_COLUMNS,
  INVENTORY_CSV_HEADERS,
  INVENTORY_CSV_VERSION,
  INVENTORY_CSV_VERSION_HEADER,
  MAX_INVENTORY_CSV_BYTES,
  MAX_INVENTORY_CSV_ROWS,
  PHOTO_LIST_SEPARATOR,
  type InventoryImportLocation,
  type InventoryImportPlan,
  type InventoryImportRecord,
  type InventoryImportResult,
  type InventoryImportStatus,
  type InventoryPhotoStatus,
  type InventoryRowResult,
  type Paginated,
} from '@vintrax/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { VehiclesService } from '../vehicles/vehicles.service';
import { InventoryPhotosService, type VehiclePhotoWork } from './inventory-photos.service';
import { CsvParseError, toCsv } from './csv';
import {
  CREATE_REQUIRED_FIELDS,
  planInventoryImport,
  summarise,
  type ExistingVehicle,
  type PlannedRow,
  type VehicleDraft,
} from './inventory-plan';

/**
 * Dealer inventory as a CSV file.
 *
 * Ownership is the whole design here. A dealership's inventory is the set of
 * vehicles whose `sellerId` is the dealer's own user id — there is no separate
 * dealer column on Vehicle, and this service does not add one. Every query in
 * this file is scoped by `sellerId: user.id`, taken from the verified JWT and
 * never from the request body or the file. A CSV cannot name its owner; see
 * `IGNORED_OWNERSHIP_COLUMNS`.
 *
 * That scoping is also what makes cross-dealer matching impossible rather than
 * merely forbidden: a row whose VIN belongs to another seller does not match
 * anything, so the worst it can do is create a vehicle in the caller's own
 * inventory.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  /** Rows per transaction. Small enough not to hold a long write lock. */
  private static readonly BATCH_SIZE = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly vehicles: VehiclesService,
    private readonly photos: InventoryPhotosService,
  ) {}

  /**
   * A blank file with the canonical headers and one documentation row.
   *
   * The documentation row is a comment column-by-column rather than a fake
   * vehicle: a sample row gets imported by accident, and a dealer's first
   * import creating a phantom 2020 Honda is a bad first impression. The row is
   * prefixed `#`, and the importer treats it as an ordinary row that fails
   * validation loudly if it is left in — visible, not silent.
   */
  template(): string {
    const documentation = INVENTORY_CSV_COLUMNS.map(
      (column) =>
        `# ${column.required ? 'REQUIRED' : 'optional'} — ${column.description}${
          column.enumValues ? ` One of: ${column.enumValues.join(' | ')}.` : ''
        }`,
    );

    return toCsv([
      [`${INVENTORY_CSV_VERSION_HEADER}=${INVENTORY_CSV_VERSION}`],
      INVENTORY_CSV_HEADERS,
      documentation,
    ]);
  }

  /**
   * The caller's own inventory, in the schema the importer accepts.
   *
   * Round-trips: export, edit in a spreadsheet, re-import. Every row carries an
   * identifier, so the re-import matches rather than duplicating. Internal and
   * commercially sensitive fields are absent by construction — the column list
   * is the canonical one, and nothing outside it is emitted.
   */
  async exportInventory(user: AuthUser): Promise<string> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { sellerId: user.id },
      orderBy: [{ createdAt: 'desc' }],
      select: EXPORT_SELECT,
    });

    const rows = vehicles.map((vehicle) =>
      INVENTORY_CSV_HEADERS.map((header) => {
        const value = EXPORT_VALUE[header]?.(vehicle);
        return value ?? '';
      }),
    );

    return toCsv([
      [`${INVENTORY_CSV_VERSION_HEADER}=${INVENTORY_CSV_VERSION}`],
      INVENTORY_CSV_HEADERS,
      ...rows,
    ]);
  }

  /**
   * What the file would do. Writes nothing.
   *
   * The dealer sees this before anything changes, which is the point: a bulk
   * edit to 200 listings is not something to discover after the fact.
   */
  async validate(
    file: { buffer: Buffer; originalname: string; mimetype?: string },
    user: AuthUser,
    location: InventoryImportLocation = EMPTY_LOCATION,
  ): Promise<InventoryImportPlan> {
    const { text, hash } = this.readFile(file);
    const plan = await this.buildPlan(text, user, location);

    return {
      schemaVersion: INVENTORY_CSV_VERSION,
      fileHash: hash,
      filename: file.originalname,
      summary: plan.summary,
      rows: plan.rows.map(stripInternals),
      mappedColumns: plan.mappedColumns,
      ignoredColumns: plan.ignoredColumns,
      unrecognisedColumns: plan.unrecognisedColumns,
      defaultLocation: plan.defaultLocation,
    };
  }

  /**
   * Applies the file.
   *
   * The plan is rebuilt here rather than carried over from the preview, so the
   * decision to write is made against the database as it is now, not as it was
   * when the dealer looked. `expectedHash` is what ties the two together: it is
   * the preview's file, and a different file is refused rather than imported
   * under a summary the dealer never saw.
   *
   * Valid rows are applied and invalid ones are skipped — partial import, which
   * is the only workable model when one bad row in a 500-row dealer export
   * would otherwise block the other 499. Nothing is skipped silently: every
   * skipped row comes back with its errors, and the counts are recorded.
   */
  async confirm(
    file: { buffer: Buffer; originalname: string; mimetype?: string },
    expectedHash: string,
    user: AuthUser,
    location: InventoryImportLocation = EMPTY_LOCATION,
    importPhotos = true,
  ): Promise<InventoryImportResult> {
    const { text, hash } = this.readFile(file);

    if (hash !== expectedHash) {
      throw new BadRequestException(
        'This is not the file that was previewed. Preview the import again before confirming.',
      );
    }

    const plan = await this.buildPlan(text, user, location);
    const actionable = plan.rows.filter(
      (row) => row.action === 'CREATE' || row.action === 'UPDATE',
    );

    const applied: PlannedRow[] = [];
    for (let index = 0; index < actionable.length; index += InventoryService.BATCH_SIZE) {
      const batch = actionable.slice(index, index + InventoryService.BATCH_SIZE);
      // One transaction per batch rather than one for the file: a 2000-row
      // import inside a single transaction holds write locks for the whole run.
      // A batch that fails rolls back only itself, and the row results say
      // exactly which vehicles were written.
      await this.prisma.$transaction(async (tx) => {
        for (const row of batch) {
          const id =
            row.action === 'CREATE'
              ? await this.createVehicle(tx, row.draft!, user)
              : await this.updateVehicle(tx, row.targetId!, row.draft!, user);
          applied.push({ ...row, vehicleId: id });
        }
      });
    }

    const writtenIds = applied.map((row) => row.vehicleId!).filter(Boolean);
    await this.vehicles.afterBulkWrite(writtenIds);

    const byRow = new Map(applied.map((row) => [row.row, row]));
    const rows = plan.rows.map((row) => stripInternals(byRow.get(row.row) ?? row));
    const summary = summarise(rows);
    const status: InventoryImportStatus =
      summary.errors > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';

    const record = await this.prisma.inventoryImport.create({
      data: {
        sellerId: user.id,
        initiatedById: user.id,
        filename: file.originalname,
        schemaVersion: INVENTORY_CSV_VERSION,
        fileHash: hash,
        status,
        totalRows: summary.totalRows,
        createdCount: summary.create,
        updatedCount: summary.update,
        unchangedCount: summary.unchanged,
        errorCount: summary.errors,
        rows: rows as unknown as object,
        completedAt: new Date(),
      },
      select: { id: true },
    });

    // The existing audit trail, not a second one. One entry for the run; the
    // per-vehicle detail lives on the import record this points at.
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'inventory.imported',
      entityType: 'InventoryImport',
      entityId: record.id,
      metadata: {
        filename: file.originalname,
        schemaVersion: INVENTORY_CSV_VERSION,
        ...summary,
      },
    });

    this.logger.log(
      `Inventory import ${record.id}: ${summary.create} created, ${summary.update} updated, ${summary.unchanged} unchanged, ${summary.errors} skipped`,
    );

    await this.startPhotoRun(record.id, plan.rows, byRow, importPhotos);

    return { importId: record.id, status, summary, rows };
  }

  /**
   * Starts the photo download for an import that has already been written.
   *
   * Deliberately not awaited. A rooftop's feed is roughly two dozen photos per
   * vehicle — around 1,100 downloads for a 47-row file — which is minutes of
   * fetching from a third-party server, and holding the dealer's request open
   * for that would time out long before it finished. The vehicles are already
   * saved and already returned; the photos catch up, and the import record
   * carries the progress so the history screen can say where it got to.
   *
   * Every row that resolved to a vehicle contributes, including UNCHANGED ones:
   * re-photographing a car changes nothing else about it, so a sync that only
   * covered rows whose fields moved would never pick new pictures up.
   */
  private async startPhotoRun(
    importId: string,
    rows: readonly PlannedRow[],
    written: ReadonlyMap<number, PlannedRow>,
    requested: boolean,
  ): Promise<void> {
    const work: VehiclePhotoWork[] = [];

    for (const row of rows) {
      if (row.action === 'ERROR') continue;
      const photos = row.photos ?? [];
      if (photos.length === 0) continue;
      const vehicleId = written.get(row.row)?.vehicleId ?? row.targetId;
      if (vehicleId) work.push({ vehicleId, photos });
    }

    if (!requested || work.length === 0) return;

    const expected = InventoryPhotosService.expectedCount(work);
    await this.prisma.inventoryImport.update({
      where: { id: importId },
      data: { photoStatus: 'PENDING', photosExpected: expected },
    });

    // Floating on purpose, and the reason it is safe to float: `run` never
    // throws, and the work is idempotent, so an interrupted process loses
    // progress but not correctness — re-running the same file picks up where
    // this left off and downloads nothing it already has.
    void this.photos.run(importId, work);
  }

  /** Past runs, newest first. Scoped to the caller's own inventory. */
  async history(
    user: AuthUser,
    page: number,
    pageSize: number,
  ): Promise<Paginated<InventoryImportRecord>> {
    const where = { sellerId: user.id };
    const [total, records] = await Promise.all([
      this.prisma.inventoryImport.count({ where }),
      this.prisma.inventoryImport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: HISTORY_SELECT,
      }),
    ]);

    return {
      items: records.map(toRecord),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** One past run, with its per-row outcomes. */
  async historyDetail(
    id: string,
    user: AuthUser,
  ): Promise<InventoryImportRecord & { rows: InventoryRowResult[] }> {
    const record = await this.prisma.inventoryImport.findUnique({
      where: { id },
      select: { ...HISTORY_SELECT, rows: true, sellerId: true },
    });

    // A 404 rather than a 403 for somebody else's import, so this endpoint
    // cannot be used to learn which import ids exist.
    if (!record || record.sellerId !== user.id) {
      throw new NotFoundException('Import not found');
    }

    return {
      ...toRecord(record),
      rows: Array.isArray(record.rows) ? (record.rows as unknown as InventoryRowResult[]) : [],
    };
  }

  // --- Internals -------------------------------------------------------------

  /**
   * Bytes to text, with the checks that belong before parsing.
   *
   * The filename extension is not trusted and is not consulted: the size and
   * the decoded content are what decide. A file that is not valid UTF-8, or
   * that carries a NUL byte, is a binary upload wearing a .csv name.
   */
  private readFile(file: { buffer: Buffer; originalname: string }): {
    text: string;
    hash: string;
  } {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('The uploaded file is empty.');
    }

    if (file.buffer.length > MAX_INVENTORY_CSV_BYTES) {
      throw new BadRequestException(
        `The file is ${(file.buffer.length / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_INVENTORY_CSV_BYTES / 1024 / 1024}MB and ${MAX_INVENTORY_CSV_ROWS} rows.`,
      );
    }

    const text = file.buffer.toString('utf8');

    // Node substitutes U+FFFD for bytes that are not valid UTF-8. A CSV saved
    // as Windows-1252 with an accented make would arrive quietly mangled, so it
    // is refused with an instruction the dealer can act on.
    if (text.includes('�')) {
      throw new BadRequestException(
        'The file is not valid UTF-8. Re-save it as "CSV UTF-8" from your spreadsheet and upload it again.',
      );
    }

    if (text.includes('\0')) {
      throw new BadRequestException('The file contains binary data and is not a CSV.');
    }

    return { text, hash: createHash('sha256').update(file.buffer).digest('hex') };
  }

  /** Reads the caller's inventory and plans the file against it. */
  private async buildPlan(text: string, user: AuthUser, location: InventoryImportLocation) {
    const [existing, dealer, profile] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: { sellerId: user.id },
        select: EXISTING_SELECT,
      }),
      this.prisma.dealer.findUnique({
        where: { ownerId: user.id },
        select: { city: true, province: true },
      }),
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: { city: true, province: true },
      }),
    ]);

    // Three sources, most specific first: what the dealer chose for this
    // import, then their dealership's address, then their own profile. Every
    // one of them is the seller's own stated location — nothing here is
    // inferred from the file, and when all three are empty the fallback stays
    // null and the affected rows are refused rather than placed somewhere.
    //
    // The two halves resolve independently on purpose: a dealership with a
    // province but no city still contributes the province.
    const defaults: InventoryImportLocation = {
      city: location.city ?? dealer?.city ?? profile?.city ?? null,
      province: location.province ?? dealer?.province ?? profile?.province ?? null,
    };

    const vins = Array.from(
      new Set(existing.map((vehicle) => vehicle.vin).filter((vin): vin is string => !!vin)),
    );

    // VINs the file might mention that belong to someone else. Read only to
    // raise a warning on the row — never to match against, which is what keeps
    // one dealer out of another's inventory.
    const elsewhere = await this.prisma.vehicle.findMany({
      where: { sellerId: { not: user.id }, vin: { not: null } },
      select: { vin: true },
      take: 20_000,
    });

    try {
      return planInventoryImport({
        text,
        existing: existing as ExistingVehicle[],
        defaults,
        vinsElsewhere: new Set(
          elsewhere
            .map((row) => row.vin)
            .filter((vin): vin is string => !!vin && !vins.includes(vin)),
        ),
      });
    } catch (error) {
      if (error instanceof CsvParseError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  private async createVehicle(
    tx: TransactionClient,
    draft: VehicleDraft,
    user: AuthUser,
  ): Promise<string> {
    const fields = assertCreatable(draft);

    const created = await tx.vehicle.create({
      data: {
        ...fields,
        // `tx`, not the outer client: see the note on uniqueSlug. Passing the
        // transaction client is what keeps this from deadlocking on a
        // connection the transaction itself holds.
        slug: await this.vehicles.uniqueSlug(
          fields.year,
          fields.make,
          fields.model,
          fields.trim ?? undefined,
          tx,
        ),
        sellerId: user.id,
        // Never born published, the same rule `VehiclesService.create` follows:
        // publication is a moderation decision, and a CSV must not be a way
        // around it.
        publishedAt: null,
      },
      select: { id: true },
    });
    return created.id;
  }

  private async updateVehicle(
    tx: TransactionClient,
    id: string,
    draft: VehicleDraft,
    user: AuthUser,
  ): Promise<string> {
    // The `sellerId` in the filter is not decoration. Even though the id came
    // from a match against this seller's own vehicles, writing it as part of
    // the where clause means a bug elsewhere in this file cannot turn into a
    // write to another dealer's row: the update would match nothing instead.
    const result = await tx.vehicle.updateMany({
      where: { id, sellerId: user.id },
      data: draft,
    });

    if (result.count === 0) {
      throw new NotFoundException('Vehicle not found');
    }
    return id;
  }
}

/** A draft the planner has established is complete enough to create. */
type CreatableDraft = VehicleDraft & Required<Pick<VehicleDraft, CreateRequiredField>>;

type CreateRequiredField = (typeof CREATE_REQUIRED_FIELDS)[number];

/**
 * Re-checks at the write boundary what the planner already established.
 *
 * The list is the planner's own, imported rather than restated. That matters:
 * the first version of this file kept a second copy, the planner's copy did not
 * include city, and a dealer export with no city column previewed as clean and
 * then failed every row here. A guard that can disagree with the thing it
 * guards is not a guard.
 *
 * So reaching here with a field absent now means a genuine bug in the planner
 * rather than bad input. Asserting makes that a loud failure of one batch
 * instead of a Prisma error whose message does not say which row, and it is
 * what lets the write be typed rather than cast through `never`.
 */
function assertCreatable(draft: VehicleDraft): CreatableDraft {
  const missing = CREATE_REQUIRED_FIELDS.filter(
    (key) => draft[key] === undefined || draft[key] === null,
  );
  if (missing.length > 0) {
    throw new BadRequestException(
      `Cannot create a vehicle without ${missing.join(', ')}. This is a bug in the importer, not in your file.`,
    );
  }
  return draft as CreatableDraft;
}

/** No location supplied with the request; the profile fallbacks still apply. */
const EMPTY_LOCATION: InventoryImportLocation = { city: null, province: null };

/** The Prisma client as seen inside an interactive transaction. */
type TransactionClient = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

const EXISTING_SELECT = {
  id: true,
  vin: true,
  stockNumber: true,
  year: true,
  make: true,
  model: true,
  trim: true,
  priceCad: true,
  reservePriceCad: true,
  mileageKm: true,
  condition: true,
  bodyType: true,
  transmission: true,
  fuelType: true,
  drivetrain: true,
  engine: true,
  engineSizeL: true,
  cylinders: true,
  doors: true,
  seats: true,
  exteriorColour: true,
  interiorColour: true,
  city: true,
  province: true,
  postalCode: true,
  title: true,
  description: true,
  features: true,
  status: true,
  saleChannel: true,
} as const;

/**
 * The export reads one thing the planner does not: the photos.
 *
 * Their *source* addresses are emitted, not the storage URLs Vintrax serves
 * them from. Two reasons. A storage URL is relative and would be refused on
 * re-import, and more importantly the source address plus its stamp is the
 * identity the importer reconciles on — so exporting them makes export, edit,
 * re-import cost zero downloads instead of a thousand.
 *
 * Photos the dealer uploaded here have no source address and so do not appear.
 * They are also never removed by an import; see `InventoryPhotosService`.
 */
const EXPORT_SELECT = {
  ...EXISTING_SELECT,
  images: {
    where: { sourceUrl: { not: null } },
    select: { sourceUrl: true, sourceUpdatedAt: true },
    orderBy: { position: 'asc' },
  },
} as const;

type ExportRow = {
  [K in keyof typeof EXPORT_SELECT]: unknown;
};

/**
 * Canonical column → the value to write.
 *
 * A table rather than a switch so that a column added to the shared definition
 * and forgotten here emits an empty cell instead of failing the export — and so
 * that the set of fields that can leave the system is a list you can read.
 */
const EXPORT_VALUE: Record<string, (row: ExportRow) => string | number | null> = {
  stock_number: (row) => (row.stockNumber as string | null) ?? null,
  vin: (row) => (row.vin as string | null) ?? null,
  year: (row) => row.year as number,
  make: (row) => row.make as string,
  model: (row) => row.model as string,
  trim: (row) => (row.trim as string | null) ?? null,
  price_cad: (row) => row.priceCad as number,
  reserve_price_cad: (row) => (row.reservePriceCad as number | null) ?? null,
  mileage_km: (row) => row.mileageKm as number,
  condition: (row) => row.condition as string,
  body_type: (row) => row.bodyType as string,
  transmission: (row) => row.transmission as string,
  fuel_type: (row) => row.fuelType as string,
  drivetrain: (row) => row.drivetrain as string,
  engine: (row) => (row.engine as string | null) ?? null,
  engine_size_l: (row) => (row.engineSizeL as number | null) ?? null,
  cylinders: (row) => (row.cylinders as number | null) ?? null,
  doors: (row) => (row.doors as number | null) ?? null,
  seats: (row) => (row.seats as number | null) ?? null,
  exterior_colour: (row) => (row.exteriorColour as string | null) ?? null,
  interior_colour: (row) => (row.interiorColour as string | null) ?? null,
  city: (row) => row.city as string,
  province: (row) => row.province as string,
  postal_code: (row) => (row.postalCode as string | null) ?? null,
  title: (row) => row.title as string,
  description: (row) => row.description as string,
  features: (row) => ((row.features as string[]) ?? []).join('|'),
  main_photo: (row) => photosOf(row)[0]?.sourceUrl ?? null,
  main_photo_updated_at: (row) => photosOf(row)[0]?.sourceUpdatedAt?.toISOString() ?? null,
  extra_photos: (row) =>
    photosOf(row)
      .slice(1)
      .map((photo) => photo.sourceUrl)
      .join(PHOTO_LIST_SEPARATOR) || null,
  extra_photos_updated_at: (row) =>
    photosOf(row)
      .slice(1)
      .map((photo) => photo.sourceUpdatedAt?.toISOString() ?? '')
      .join(PHOTO_LIST_SEPARATOR) || null,
  // Exported so a dealer can see it, and accepted on import only for the four
  // seller-settable values. A vehicle exported as ACTIVE or IN_AUCTION and
  // re-imported keeps its status, because the importer ignores a value it may
  // not set rather than failing the row.
  listing_status: (row) => row.status as string,
  sale_channel: (row) => row.saleChannel as string,
};

const HISTORY_SELECT = {
  id: true,
  filename: true,
  schemaVersion: true,
  status: true,
  totalRows: true,
  createdCount: true,
  updatedCount: true,
  unchangedCount: true,
  errorCount: true,
  createdAt: true,
  completedAt: true,
  photoStatus: true,
  photosExpected: true,
  photosFetched: true,
  photosReused: true,
  photosFailed: true,
  photoErrors: true,
  photosFinishedAt: true,
  initiatedBy: { select: { email: true } },
} as const;

function toRecord(record: {
  id: string;
  filename: string;
  schemaVersion: number;
  status: string;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  errorCount: number;
  createdAt: Date;
  completedAt: Date | null;
  photoStatus: string;
  photosExpected: number;
  photosFetched: number;
  photosReused: number;
  photosFailed: number;
  photoErrors: string[];
  photosFinishedAt: Date | null;
  initiatedBy: { email: string } | null;
}): InventoryImportRecord {
  return {
    id: record.id,
    filename: record.filename,
    schemaVersion: record.schemaVersion,
    status: record.status as InventoryImportStatus,
    totalRows: record.totalRows,
    createdCount: record.createdCount,
    updatedCount: record.updatedCount,
    unchangedCount: record.unchangedCount,
    errorCount: record.errorCount,
    initiatedByEmail: record.initiatedBy?.email ?? null,
    createdAt: record.createdAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    photos: {
      status: record.photoStatus as InventoryPhotoStatus,
      expected: record.photosExpected,
      fetched: record.photosFetched,
      reused: record.photosReused,
      failed: record.photosFailed,
      errors: record.photoErrors,
      finishedAt: record.photosFinishedAt?.toISOString() ?? null,
    },
  };
}

/** An exported row's imported photos, in display order. */
function photosOf(row: ExportRow): Array<{ sourceUrl: string; sourceUpdatedAt: Date | null }> {
  const images = (row as { images?: unknown }).images;
  return Array.isArray(images)
    ? (images as Array<{ sourceUrl: string; sourceUpdatedAt: Date | null }>)
    : [];
}

/** Drops the fields the planner uses internally and the client has no business seeing. */
function stripInternals(row: PlannedRow): InventoryRowResult {
  // `photos` goes too. The client is told how many there are via `photoCount`;
  // the third-party addresses they came from are not the buyer's business and
  // are not worth persisting in the import record's JSON either.
  const { draft: _draft, targetId: _targetId, photos: _photos, ...rest } = row;
  return rest;
}
