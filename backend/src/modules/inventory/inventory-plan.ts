import {
  BODY_TYPES,
  DRIVETRAINS,
  ENUM_SYNONYMS,
  FUEL_TYPES,
  INVENTORY_CSV_COLUMNS,
  INVENTORY_CSV_VERSION_HEADER,
  LISTING_STATUSES,
  MAX_INVENTORY_CSV_ROWS,
  PROVINCES,
  SALE_CHANNELS,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
  inventoryYearRange,
  isValidVin,
  normaliseDecimal,
  normaliseEnum,
  normaliseFeatures,
  normaliseHeader,
  normaliseInteger,
  normaliseText,
  normaliseVin,
  resolveHeader,
  type BodyType,
  type Drivetrain,
  type FuelType,
  type InventoryImportSummary,
  type InventoryRowResult,
  type ListingStatus,
  type Province,
  type SaleChannel,
  type Transmission,
  type VehicleCondition,
} from '@vintrax/shared';
import { CsvParseError, isBlankRow, parseCsv } from './csv';

/**
 * Turning an uploaded file into a plan.
 *
 * Deliberately pure: it takes the file text plus a snapshot of what the seller
 * already has, and returns what would happen. The preview endpoint and the
 * confirm endpoint both run this, which is what makes the preview trustworthy —
 * it is not a description of the import, it is the import, without the writes.
 */

/** The four listing statuses a CSV may set. ACTIVE is not among them. */
export const CSV_SETTABLE_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'ARCHIVED', 'SOLD'] as const;
export type CsvSettableStatus = (typeof CSV_SETTABLE_STATUSES)[number];

/** A vehicle as the importer needs to see it, to decide create/update/unchanged. */
export interface ExistingVehicle {
  id: string;
  vin: string | null;
  stockNumber: string | null;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  priceCad: number;
  reservePriceCad: number | null;
  mileageKm: number;
  condition: VehicleCondition;
  bodyType: BodyType;
  transmission: Transmission;
  fuelType: FuelType;
  drivetrain: Drivetrain;
  engine: string | null;
  engineSizeL: number | null;
  cylinders: number | null;
  doors: number | null;
  seats: number | null;
  exteriorColour: string | null;
  interiorColour: string | null;
  city: string;
  province: Province;
  postalCode: string | null;
  title: string;
  description: string;
  features: string[];
  /** Everything a listing can be, not only what a CSV may set. */
  status: ListingStatus;
  saleChannel: SaleChannel;
}

/** The fields a CSV row can set, after normalisation. Absent means "not in the file". */
export type VehicleDraft = Partial<{
  stockNumber: string | null;
  vin: string | null;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  priceCad: number;
  reservePriceCad: number | null;
  mileageKm: number;
  condition: VehicleCondition;
  bodyType: BodyType;
  transmission: Transmission;
  fuelType: FuelType;
  drivetrain: Drivetrain;
  engine: string | null;
  engineSizeL: number | null;
  cylinders: number | null;
  doors: number | null;
  seats: number | null;
  exteriorColour: string | null;
  interiorColour: string | null;
  city: string;
  province: Province;
  postalCode: string | null;
  title: string;
  description: string;
  features: string[];
  status: CsvSettableStatus;
  saleChannel: SaleChannel;
}>;

export interface PlannedRow extends InventoryRowResult {
  /** Present for CREATE and UPDATE. The values to write. */
  draft?: VehicleDraft;
  /** Present for UPDATE. The vehicle to write them to. */
  targetId?: string;
}

export interface PlanInput {
  text: string;
  existing: readonly ExistingVehicle[];
  /** Falls back for city and province when the file omits them. */
  defaults: { city: string | null; province: Province | null };
  /** VINs listed by other sellers, for the warning described below. */
  vinsElsewhere?: ReadonlySet<string>;
  now?: Date;
}

export interface PlanOutput {
  rows: PlannedRow[];
  summary: InventoryImportSummary;
  mappedColumns: string[];
  ignoredColumns: string[];
  unrecognisedColumns: string[];
}

const REQUIRED_KEYS = INVENTORY_CSV_COLUMNS.filter((column) => column.required).map(
  (column) => column.key,
);

/** Canonical key → the Vehicle field it writes. Identical apart from casing. */
const FIELD_BY_COLUMN: Record<string, keyof VehicleDraft> = {
  stock_number: 'stockNumber',
  vin: 'vin',
  year: 'year',
  make: 'make',
  model: 'model',
  trim: 'trim',
  price_cad: 'priceCad',
  reserve_price_cad: 'reservePriceCad',
  mileage_km: 'mileageKm',
  condition: 'condition',
  body_type: 'bodyType',
  transmission: 'transmission',
  fuel_type: 'fuelType',
  drivetrain: 'drivetrain',
  engine: 'engine',
  engine_size_l: 'engineSizeL',
  cylinders: 'cylinders',
  doors: 'doors',
  seats: 'seats',
  exterior_colour: 'exteriorColour',
  interior_colour: 'interiorColour',
  city: 'city',
  province: 'province',
  postal_code: 'postalCode',
  title: 'title',
  description: 'description',
  features: 'features',
  listing_status: 'status',
  sale_channel: 'saleChannel',
};

const MIN_DESCRIPTION = 20;

export function planInventoryImport(input: PlanInput): PlanOutput {
  const { text, existing, defaults, vinsElsewhere, now = new Date() } = input;

  const grid = parseCsv(text);
  if (grid.length === 0) throw new CsvParseError('The file is empty.');

  // The template and the export both open with `inventory_csv_version=N`, so
  // that a file carries the schema it was written against. Skipping it here is
  // what makes export → edit → re-import work at all: without this the version
  // line is read as the header row and every column fails to map.
  //
  // The offset is tracked rather than assumed, so a row number in an error
  // message is the line the dealer sees in their spreadsheet either way.
  const versionLine = grid[0]!;
  const hasVersionLine =
    versionLine[0] !== undefined &&
    normaliseHeader(versionLine[0]).startsWith(normaliseHeader(INVENTORY_CSV_VERSION_HEADER)) &&
    versionLine.slice(1).every((cell) => cell.trim().length === 0);

  const headerLine = hasVersionLine ? 1 : 0;
  const headerCells = grid[headerLine];
  if (!headerCells) throw new CsvParseError('The file has no header row.');
  const mapped: Array<{ index: number; column: string }> = [];
  const ignoredColumns: string[] = [];
  const unrecognisedColumns: string[] = [];

  headerCells.forEach((raw, index) => {
    const header = raw.trim();
    if (header.length === 0) return;
    const resolution = resolveHeader(header);
    if (resolution.kind === 'mapped') {
      // A file listing the same column twice would otherwise have one silently
      // win. The first occurrence is used and the duplicate is reported.
      if (mapped.some((entry) => entry.column === resolution.column)) {
        unrecognisedColumns.push(`${header} (duplicate of ${resolution.column})`);
        return;
      }
      mapped.push({ index, column: resolution.column });
    } else if (resolution.kind === 'ignored-ownership') {
      ignoredColumns.push(header);
    } else {
      unrecognisedColumns.push(header);
    }
  });

  if (mapped.length === 0) {
    throw new CsvParseError(
      'No recognised columns. The first line must be a header row — download the template to see the expected columns.',
    );
  }

  const dataRows = grid.slice(headerLine + 1);
  if (dataRows.length > MAX_INVENTORY_CSV_ROWS) {
    throw new CsvParseError(
      `The file has ${dataRows.length} rows. The limit is ${MAX_INVENTORY_CSV_ROWS}; split it and import in parts.`,
    );
  }

  const byVin = new Map<string, ExistingVehicle>();
  const byStock = new Map<string, ExistingVehicle>();
  for (const vehicle of existing) {
    if (vehicle.vin) byVin.set(vehicle.vin.toUpperCase(), vehicle);
    if (vehicle.stockNumber) byStock.set(vehicle.stockNumber.toLowerCase(), vehicle);
  }

  // First pass reads every row, so duplicates within the file can be reported
  // against both occurrences rather than only the second.
  //
  // Blank lines are dropped here rather than reported: a spreadsheet leaves a
  // trailing one on almost every export, and failing an import over it would
  // make the feature useless. Row numbers still count them, so the numbers in
  // an error message match what the dealer sees in their editor.
  const parsed = dataRows
    .map((cells, offset) =>
      readRow({ cells, mapped, rowNumber: offset + headerLine + 2, defaults, now }),
    )
    .filter((entry) => !entry.blank);

  flagDuplicatesWithinFile(parsed);

  const rows: PlannedRow[] = parsed.map((entry) => {
    // A VIN somebody else lists is the row a dealer is most likely to be
    // confused by — "I know this VIN exists". Computed once here so that every
    // branch below carries it; attaching it per branch is how one gets missed.
    const warnings = [...entry.warnings];
    if (entry.draft.vin && vinsElsewhere?.has(entry.draft.vin)) {
      warnings.push(
        'Another seller lists this VIN. It is not in your inventory, so nothing of theirs is touched.',
      );
    }

    if (entry.errors.length > 0) {
      return {
        row: entry.rowNumber,
        action: 'ERROR',
        vin: entry.draft.vin ?? null,
        stockNumber: entry.draft.stockNumber ?? null,
        vehicle: describe(entry.draft),
        changes: [],
        errors: entry.errors,
        warnings,
      };
    }

    const { draft } = entry;
    const match =
      (draft.vin ? byVin.get(draft.vin) : undefined) ??
      (draft.stockNumber ? byStock.get(draft.stockNumber.toLowerCase()) : undefined);

    if (!match) {
      const missing = REQUIRED_KEYS.filter(
        (key) => draft[FIELD_BY_COLUMN[key]!] === undefined || draft[FIELD_BY_COLUMN[key]!] === null,
      );
      if (missing.length > 0) {
        return {
          row: entry.rowNumber,
          action: 'ERROR',
          vin: draft.vin ?? null,
          stockNumber: draft.stockNumber ?? null,
          vehicle: describe(draft),
          changes: [],
          errors: [
            `No existing vehicle matches, so this row would create one, but these required columns are missing or empty: ${missing.join(', ')}.`,
          ],
          warnings,
        };
      }

      // The same VIN under another seller is legitimate here — a car can be
      // relisted after a sale — so this creates rather than refusing. What it
      // must never do is move that other seller's vehicle, and matching is
      // scoped to this seller precisely so it cannot.
      return {
        row: entry.rowNumber,
        action: 'CREATE',
        vin: draft.vin ?? null,
        stockNumber: draft.stockNumber ?? null,
        vehicle: describe(draft),
        changes: [],
        errors: [],
        warnings,
        draft: withCreateDefaults(draft),
      };
    }

    const changes = diff(draft, match);
    return {
      row: entry.rowNumber,
      action: changes.length === 0 ? 'UNCHANGED' : 'UPDATE',
      vin: draft.vin ?? match.vin,
      stockNumber: draft.stockNumber ?? match.stockNumber,
      vehicle: describe(draft, match),
      changes,
      errors: [],
      warnings,
      draft,
      targetId: match.id,
    };
  });

  return {
    rows,
    summary: summarise(rows),
    mappedColumns: mapped.map((entry) => entry.column),
    ignoredColumns,
    unrecognisedColumns,
  };
}

export function summarise(rows: readonly InventoryRowResult[]): InventoryImportSummary {
  return {
    totalRows: rows.length,
    create: rows.filter((row) => row.action === 'CREATE').length,
    update: rows.filter((row) => row.action === 'UPDATE').length,
    unchanged: rows.filter((row) => row.action === 'UNCHANGED').length,
    errors: rows.filter((row) => row.action === 'ERROR').length,
  };
}

interface ReadRowInput {
  cells: string[];
  mapped: Array<{ index: number; column: string }>;
  rowNumber: number;
  defaults: { city: string | null; province: Province | null };
  now: Date;
}

interface ReadRow {
  rowNumber: number;
  draft: VehicleDraft;
  errors: string[];
  warnings: string[];
  blank: boolean;
}

function readRow({ cells, mapped, rowNumber, defaults, now }: ReadRowInput): ReadRow {
  const draft: VehicleDraft = {};
  const errors: string[] = [];
  const warnings: string[] = [];

  if (isBlankRow(cells)) {
    return { rowNumber, draft, errors: [], warnings: [], blank: true };
  }

  const raw = (column: string): string | undefined => {
    const entry = mapped.find((candidate) => candidate.column === column);
    return entry ? cells[entry.index] : undefined;
  };
  const present = (column: string): boolean =>
    mapped.some((candidate) => candidate.column === column);

  // --- Identity ---
  if (present('vin')) {
    const vin = normaliseVin(raw('vin'));
    if (vin !== null) {
      if (!isValidVin(vin)) {
        // Never repaired into something valid-looking. A VIN is the strongest
        // identifier the importer has, and a padded or truncated one would
        // attach this row to the wrong car.
        errors.push(
          `VIN "${vin}" is not valid: it must be 17 characters and exclude the letters I, O and Q.`,
        );
      } else {
        draft.vin = vin;
      }
    } else {
      draft.vin = null;
    }
  }

  if (present('stock_number')) {
    const stock = normaliseText(raw('stock_number'));
    if (stock !== null && stock.length > 60) {
      errors.push('Stock number is longer than 60 characters.');
    } else {
      draft.stockNumber = stock;
    }
  }

  if (!draft.vin && !draft.stockNumber) {
    errors.push(
      'Every row needs a vin or a stock_number so it can be matched to a vehicle. Both are empty.',
    );
  }

  // --- Numbers ---
  const years = inventoryYearRange(now);
  readNumber({
    column: 'year',
    field: 'year',
    parse: normaliseInteger,
    min: years.min,
    max: years.max,
    label: `a model year between ${years.min} and ${years.max}`,
  });
  readNumber({
    column: 'price_cad',
    field: 'priceCad',
    parse: normaliseInteger,
    min: 1,
    max: 10_000_000,
    label: 'a price in whole dollars, at least 1',
  });
  readNumber({
    column: 'reserve_price_cad',
    field: 'reservePriceCad',
    parse: normaliseInteger,
    min: 0,
    max: 10_000_000,
    label: 'a reserve price in whole dollars',
    nullable: true,
  });
  readNumber({
    column: 'mileage_km',
    field: 'mileageKm',
    parse: normaliseInteger,
    min: 0,
    max: 2_000_000,
    label: 'a kilometre reading between 0 and 2,000,000',
  });
  readNumber({
    column: 'engine_size_l',
    field: 'engineSizeL',
    parse: normaliseDecimal,
    min: 0,
    max: 20,
    label: 'an engine size in litres, up to 20',
    nullable: true,
  });
  readNumber({
    column: 'cylinders',
    field: 'cylinders',
    parse: normaliseInteger,
    min: 0,
    max: 16,
    label: 'a cylinder count up to 16',
    nullable: true,
  });
  readNumber({
    column: 'doors',
    field: 'doors',
    parse: normaliseInteger,
    min: 0,
    max: 8,
    label: 'a door count up to 8',
    nullable: true,
  });
  readNumber({
    column: 'seats',
    field: 'seats',
    parse: normaliseInteger,
    min: 0,
    max: 60,
    label: 'a seat count up to 60',
    nullable: true,
  });

  function readNumber(spec: {
    column: string;
    field: keyof VehicleDraft;
    parse: (value: string | undefined) => number | null | undefined;
    min: number;
    max: number;
    label: string;
    nullable?: boolean;
  }): void {
    if (!present(spec.column)) return;
    const value = spec.parse(raw(spec.column));

    if (value === undefined) {
      // An optional field that cannot be read costs the field, not the vehicle.
      // This feed writes "Electric" in its engine-size column, and failing a
      // whole listing over a detail it does not need would be the wrong trade.
      // Reported, so it is not a silent drop.
      if (spec.nullable) {
        warnings.push(
          `${spec.column} "${normaliseText(raw(spec.column))}" is not a number, so it is left empty. Expected ${spec.label}.`,
        );
        return;
      }
      errors.push(`${spec.column} is not a number. Expected ${spec.label}.`);
      return;
    }
    if (value === null) {
      if (spec.nullable) (draft as Record<string, unknown>)[spec.field] = null;
      return;
    }
    if (value < spec.min || value > spec.max) {
      errors.push(`${spec.column} is ${value}. Expected ${spec.label}.`);
      return;
    }
    (draft as Record<string, unknown>)[spec.field] = value;
  }

  // --- Enumerations ---
  readEnum('condition', 'condition', VEHICLE_CONDITIONS, ENUM_SYNONYMS.condition);
  readEnum('body_type', 'bodyType', BODY_TYPES, ENUM_SYNONYMS.bodyType);
  readEnum('transmission', 'transmission', TRANSMISSIONS, ENUM_SYNONYMS.transmission, 'OTHER');
  readEnum('fuel_type', 'fuelType', FUEL_TYPES, ENUM_SYNONYMS.fuelType);
  readEnum('drivetrain', 'drivetrain', DRIVETRAINS, ENUM_SYNONYMS.drivetrain, 'OTHER');
  readEnum('province', 'province', PROVINCES, {});
  readEnum('sale_channel', 'saleChannel', SALE_CHANNELS, {});
  readListingStatus();

  /**
   * The listing's own status, which is the one column where "not settable" and
   * "not valid" are different answers.
   *
   * An export carries the real status, so a live car comes back as ACTIVE and a
   * car under auction as IN_AUCTION. Neither may be set from a CSV — publishing
   * is a moderation decision — but failing those rows would break the export →
   * edit → re-import promise for every dealer with something live, which is all
   * of them. So a real status that this column may not set is left alone and
   * reported; only a value that is not a status at all is an error.
   */
  function readListingStatus(): void {
    if (!present('listing_status')) return;
    const settable = normaliseEnum(raw('listing_status'), CSV_SETTABLE_STATUSES, {});
    if (settable !== undefined) {
      if (settable !== null) draft.status = settable;
      return;
    }

    const known = normaliseEnum(raw('listing_status'), LISTING_STATUSES, {});
    if (known !== undefined && known !== null) {
      warnings.push(
        `listing_status "${known}" cannot be set from a CSV, so this row leaves it unchanged. Publishing and auctions are handled on the listing itself.`,
      );
      return;
    }

    errors.push(
      `listing_status "${normaliseText(raw('listing_status'))}" is not a recognised value. Accepted: ${CSV_SETTABLE_STATUSES.join(', ')}.`,
    );
  }

  /**
   * `whenBlank` is only passed for the two enumerations that carry `OTHER`, and
   * it is not a guess: recording "the file did not say" as OTHER is truthful,
   * where filling in FWD for a 1989 pickup would not be. The row carries a
   * warning either way, so nothing about it is silent. Every other required
   * enumeration is complete, so a blank there is missing data and fails the row.
   */
  function readEnum(
    column: string,
    field: keyof VehicleDraft,
    allowed: readonly string[],
    synonyms: Readonly<Record<string, string>>,
    whenBlank?: string,
  ): void {
    if (!present(column)) return;
    const value = normaliseEnum(raw(column), allowed, synonyms);

    if (value === undefined) {
      const attempted = normaliseText(raw(column));
      // Never invented. An unrecognised fuel type is a question for the dealer,
      // not something to guess at.
      errors.push(
        `${column} "${attempted}" is not a recognised value. Accepted: ${allowed.join(', ')}.`,
      );
      return;
    }

    if (value === null) {
      if (whenBlank) {
        (draft as Record<string, unknown>)[field] = whenBlank;
        warnings.push(`${column} was blank, so it is recorded as ${whenBlank}.`);
      }
      return;
    }

    (draft as Record<string, unknown>)[field] = value;
  }

  // --- Text ---
  readText('make', 'make', 60);
  readText('model', 'model', 60);
  readText('trim', 'trim', 60, true);
  readText('engine', 'engine', 80, true);
  readText('exterior_colour', 'exteriorColour', 40, true);
  readText('interior_colour', 'interiorColour', 40, true);
  readText('city', 'city', 80);
  readText('postal_code', 'postalCode', 10, true);
  readText('title', 'title', 160);

  function readText(
    column: string,
    field: keyof VehicleDraft,
    max: number,
    nullable = false,
  ): void {
    if (!present(column)) return;
    const value = normaliseText(raw(column));
    if (value === null) {
      if (nullable) (draft as Record<string, unknown>)[field] = null;
      return;
    }
    if (value.length > max) {
      errors.push(`${column} is longer than ${max} characters.`);
      return;
    }
    (draft as Record<string, unknown>)[field] = value;
  }

  if (present('description')) {
    const value = normaliseText(raw('description'));
    if (value !== null) {
      if (value.length < MIN_DESCRIPTION) {
        errors.push(
          `description is ${value.length} characters. Listings need at least ${MIN_DESCRIPTION}; leave the cell empty to have one generated.`,
        );
      } else if (value.length > 8000) {
        errors.push('description is longer than 8000 characters.');
      } else {
        draft.description = value;
      }
    }
  }

  if (present('features')) {
    const features = normaliseFeatures(raw('features'));
    if (features !== null) draft.features = features;
  }

  // A file that omits city or province falls back to the dealership's own
  // location rather than failing, which is what makes a three-column reprice
  // file work. The fallback only applies where the file said nothing.
  if (draft.city === undefined && defaults.city) draft.city = defaults.city;
  if (draft.province === undefined && defaults.province) draft.province = defaults.province;

  return { rowNumber, draft, errors, warnings, blank: false };
}

/**
 * Two rows in one file claiming the same vehicle.
 *
 * Both are refused rather than last-one-wins, because the file does not say
 * which is correct and guessing would write one of two different prices.
 */
function flagDuplicatesWithinFile(rows: ReadRow[]): void {
  const seen = new Map<string, number[]>();

  rows.forEach((row) => {
    if (row.blank) return;
    for (const key of identityKeys(row.draft)) {
      const found = seen.get(key) ?? [];
      found.push(row.rowNumber);
      seen.set(key, found);
    }
  });

  rows.forEach((row) => {
    if (row.blank) return;
    for (const key of identityKeys(row.draft)) {
      const occurrences = seen.get(key) ?? [];
      if (occurrences.length > 1) {
        const [label, value] = key.split(':');
        const others = occurrences.filter((number) => number !== row.rowNumber);
        row.errors.push(
          `Duplicate ${label} "${value}" in this file: also on ${others.length === 1 ? 'row' : 'rows'} ${others.join(', ')}. Remove the duplicate and import again.`,
        );
      }
    }
  });
}

function identityKeys(draft: VehicleDraft): string[] {
  const keys: string[] = [];
  if (draft.vin) keys.push(`vin:${draft.vin}`);
  if (draft.stockNumber) keys.push(`stock_number:${draft.stockNumber.toLowerCase()}`);
  return keys;
}

/** Fields the CSV set that differ from what is stored. Order follows the columns. */
function diff(draft: VehicleDraft, existing: ExistingVehicle): string[] {
  const changed: string[] = [];

  for (const column of INVENTORY_CSV_COLUMNS) {
    const field = FIELD_BY_COLUMN[column.key];
    if (!field) continue;
    if (!(field in draft)) continue;

    const next = draft[field];
    const current = (existing as unknown as Record<string, unknown>)[field];

    if (Array.isArray(next)) {
      const before = Array.isArray(current) ? current : [];
      const same =
        before.length === next.length && next.every((value, index) => before[index] === value);
      if (!same) changed.push(field);
      continue;
    }

    // `null` and `undefined` both mean "nothing stored" for a nullable column,
    // so an empty cell against an empty field is not a change. Without this,
    // re-importing an unmodified export would report every blank as an edit and
    // the importer would not be idempotent.
    const a = next ?? null;
    const b = current ?? null;
    if (a !== b) changed.push(field);
  }

  return changed;
}

/** Fills what a new listing needs and the file did not say. */
function withCreateDefaults(draft: VehicleDraft): VehicleDraft {
  const filled: VehicleDraft = { ...draft };

  if (!filled.title) {
    filled.title = [filled.year, filled.make, filled.model, filled.trim]
      .filter(Boolean)
      .join(' ')
      .slice(0, 160);
  }

  if (!filled.description) {
    // Factual only: every clause restates a value from the row. The importer
    // must not write marketing claims on a dealer's behalf, and a listing with
    // no description at all fails the create schema.
    const parts = [
      [filled.year, filled.make, filled.model, filled.trim].filter(Boolean).join(' '),
      filled.mileageKm !== undefined ? `${filled.mileageKm.toLocaleString('en-CA')} km` : null,
      filled.transmission ? filled.transmission.toLowerCase().replace(/_/g, ' ') : null,
      filled.drivetrain ?? null,
    ].filter(Boolean);
    filled.description = `${parts.join(' · ')}. Imported from dealer inventory — contact the dealership for full details.`;
  }

  if (!filled.status) filled.status = 'DRAFT';
  if (!filled.saleChannel) filled.saleChannel = 'FIXED_PRICE';
  if (!filled.features) filled.features = [];

  return filled;
}

function describe(draft: VehicleDraft, fallback?: ExistingVehicle): string | null {
  const parts = [
    draft.year ?? fallback?.year,
    draft.make ?? fallback?.make,
    draft.model ?? fallback?.model,
    draft.trim ?? fallback?.trim,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}
