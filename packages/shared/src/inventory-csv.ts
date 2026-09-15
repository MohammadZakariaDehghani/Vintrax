import {
  BODY_TYPES,
  DRIVETRAINS,
  FUEL_TYPES,
  MIN_MODEL_YEAR,
  PROVINCES,
  SALE_CHANNELS,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
  VIN_PATTERN,
  maxModelYear,
  type Province,
} from './domain';

/**
 * The dealer inventory CSV contract.
 *
 * One definition, shared by the importer, the exporter, the template and the
 * web UI, because the promise this feature makes is that a dealer can export,
 * edit in a spreadsheet and re-import. Two definitions drift, and the drift
 * shows up as a dealer's inventory being silently wrong.
 *
 * The version is part of that promise. A template generated today states its
 * version, and the importer records the version it read, so when a column is
 * added or renamed there is a fact to reason from rather than a guess.
 */
export const INVENTORY_CSV_VERSION = 2;

/** The header the template and the exporter both emit as the first line. */
export const INVENTORY_CSV_VERSION_HEADER = 'inventory_csv_version';

/**
 * Limits, enforced by the server rather than by the browser.
 *
 * A dealership rooftop runs in the hundreds of units, not the hundreds of
 * thousands, so 2000 rows is generous for the first implementation and small
 * enough that the whole file fits in memory and the import completes inside a
 * request. A larger file is refused with a message that says so, rather than
 * being accepted and timing out halfway through.
 */
export const MAX_INVENTORY_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_INVENTORY_CSV_ROWS = 2000;

/** What the importer decided a row means. */
export const INVENTORY_ROW_ACTIONS = ['CREATE', 'UPDATE', 'UNCHANGED', 'ERROR'] as const;
export type InventoryRowAction = (typeof INVENTORY_ROW_ACTIONS)[number];

export const INVENTORY_IMPORT_STATUSES = [
  'VALIDATED',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
] as const;
export type InventoryImportStatus = (typeof INVENTORY_IMPORT_STATUSES)[number];

/**
 * The canonical columns, in the order the template and the export emit them.
 *
 * `required` means required to CREATE a vehicle. An UPDATE only needs an
 * identifier plus whatever is actually changing, which is what makes a
 * three-column "reprice everything" file work.
 */
export interface InventoryCsvColumn {
  /** The canonical header, and the key on a parsed row. */
  readonly key: string;
  /** Required to create a new vehicle. */
  readonly required: boolean;
  /** Shown in the template's documentation row and in the UI. */
  readonly description: string;
  /** Accepted values, where the field is an enumeration. */
  readonly enumValues?: readonly string[];
  /** Additional headers that map to this column. See `HEADER_ALIASES`. */
  readonly aliases?: readonly string[];
}

/**
 * Ownership is never a column.
 *
 * These names are recognised only so the importer can say "this column was
 * ignored, and here is why" instead of silently dropping it. A dealer who
 * exports from another system and re-imports here would otherwise have no way
 * to know their dealer_id column did nothing — and the one thing worse than
 * rejecting a column is appearing to accept it.
 *
 * The server derives ownership from the authenticated user. See D-029.
 */
export const IGNORED_OWNERSHIP_COLUMNS = [
  'id',
  'vehicle_id',
  'seller_id',
  'sellerid',
  'dealer_id',
  'dealerid',
  'dealership_id',
  'dealershipid',
  'owner_id',
  'ownerid',
  'account_id',
  'accountid',
  // A DMS export identifies the rooftop it came from. It is still ownership.
  'companyid',
  'company_id',
  'rooftop_id',
  'rooftopid',
  'slug',
  'user_id',
  'userid',
] as const;

export const INVENTORY_CSV_COLUMNS: readonly InventoryCsvColumn[] = [
  {
    key: 'stock_number',
    required: false,
    description:
      "Your own stock number. Unique within your inventory. Used to match rows when there is no VIN, and it is how a vehicle you have not given a VIN stays matchable across imports.",
    aliases: ['stock', 'stock#', 'stockno', 'stocknumber', 'stockid', 'dealerstocknumber'],
  },
  {
    key: 'vin',
    required: false,
    description:
      '17 characters, excluding I, O and Q. The strongest match: a row with a VIN is matched on VIN first. Either vin or stock_number must be present.',
    aliases: ['vinnumber', 'vehiclevin', 'vin17', 'serialnumber'],
  },
  {
    key: 'year',
    required: true,
    description: `Model year, ${MIN_MODEL_YEAR} to next year.`,
    aliases: ['modelyear', 'yr'],
  },
  { key: 'make', required: true, description: 'Manufacturer, e.g. Toyota.', aliases: ['brand', 'manufacturer'] },
  { key: 'model', required: true, description: 'Model name, e.g. RAV4.', aliases: ['modelname'] },
  { key: 'trim', required: false, description: 'Trim level, e.g. XLE.', aliases: ['trimlevel', 'series', 'style'] },
  {
    key: 'price_cad',
    required: true,
    description: 'Asking price in Canadian dollars. $ and thousands separators are accepted.',
    aliases: ['price', 'askingprice', 'listprice', 'sellingprice', 'retailprice', 'pricecad'],
  },
  {
    key: 'reserve_price_cad',
    required: false,
    description: 'Lowest price you will accept at auction. Never shown to buyers.',
    aliases: ['reserve', 'reserveprice', 'floorprice'],
  },
  {
    key: 'mileage_km',
    required: true,
    description: 'Odometer reading in kilometres. "km" and thousands separators are accepted.',
    aliases: [
      'mileage',
      'odometer',
      'km',
      'kms',
      'kilometres',
      'kilometers',
      'odometerkm',
      'mileagekms',
    ],
  },
  {
    key: 'condition',
    required: true,
    description: 'Vehicle condition. A dealership export usually calls this column Status.',
    enumValues: VEHICLE_CONDITIONS,
    // `status` is here rather than on the listing status deliberately. In every
    // dealership feed seen so far, a column called Status holds New or Used —
    // the vehicle's condition. The listing's own state is `listing_status`,
    // which a dealer management system has no concept of. Mapping Status to the
    // listing state instead failed every row of a real 47-vehicle export with
    // 'status "Used" is not a recognised value'.
    aliases: ['status', 'vehiclestatus', 'vehiclecondition', 'type', 'newused'],
  },
  {
    key: 'body_type',
    required: true,
    description: 'Body style.',
    enumValues: BODY_TYPES,
    aliases: ['body', 'bodystyle', 'bodytype', 'style'],
  },
  {
    key: 'transmission',
    required: true,
    description: 'Transmission type.',
    enumValues: TRANSMISSIONS,
    aliases: ['trans', 'transmissiontype', 'gearbox'],
  },
  {
    key: 'fuel_type',
    required: true,
    description: 'Fuel type.',
    enumValues: FUEL_TYPES,
    aliases: ['fuel', 'fueltype', 'enginefueltype'],
  },
  {
    key: 'drivetrain',
    required: true,
    description: 'Drivetrain.',
    enumValues: DRIVETRAINS,
    aliases: ['drive', 'drivetype', 'driveline', 'drivewheels'],
  },
  { key: 'engine', required: false, description: 'Engine description, e.g. 2.5L I4.', aliases: ['enginedescription'] },
  { key: 'engine_size_l', required: false, description: 'Engine displacement in litres.', aliases: ['displacement', 'enginesize', 'enginelitres'] },
  { key: 'cylinders', required: false, description: 'Cylinder count.', aliases: ['cylinder', 'numcylinders'] },
  { key: 'doors', required: false, description: 'Door count.', aliases: ['doorcount', 'numdoors'] },
  {
    key: 'seats',
    required: false,
    description: 'Seat count.',
    aliases: ['seatcount', 'passenger', 'passengers', 'seating', 'seatingcapacity'],
  },
  {
    key: 'exterior_colour',
    required: false,
    description: 'Exterior colour.',
    aliases: ['exteriorcolor', 'extcolour', 'extcolor', 'colour', 'color', 'exterior'],
  },
  {
    key: 'interior_colour',
    required: false,
    description: 'Interior colour.',
    aliases: ['interiorcolor', 'intcolour', 'intcolor', 'interior'],
  },
  {
    key: 'city',
    required: false,
    description: 'Where the vehicle is. Defaults to your dealership city.',
    aliases: ['location', 'locationcity'],
  },
  {
    key: 'province',
    required: false,
    description: 'Two-letter province code. Defaults to your dealership province.',
    enumValues: PROVINCES,
    aliases: ['prov', 'state', 'region'],
  },
  { key: 'postal_code', required: false, description: 'Postal code.', aliases: ['postal', 'zip', 'zipcode', 'postcode'] },
  {
    key: 'title',
    required: false,
    description: 'Listing headline. Generated from year, make, model and trim when blank.',
    aliases: ['listingtitle', 'headline'],
  },
  {
    key: 'description',
    required: false,
    description: 'Listing description, at least 20 characters. A factual placeholder is generated when blank.',
    aliases: ['comments', 'notes', 'listingdescription', 'vehicledescription', 'remarks'],
  },
  {
    key: 'features',
    required: false,
    description: 'Pipe-separated list, e.g. Sunroof|Heated seats. Semicolons also accepted.',
    aliases: ['options', 'equipment', 'featurelist'],
  },
  {
    key: 'listing_status',
    required: false,
    description:
      "The listing's own state on Vintrax, which is not the same thing as the vehicle's condition — see `condition`, which is what a dealership export's Status column means. Defaults to DRAFT on create and is left alone on update when blank. ACTIVE is not settable here; publishing is a moderation decision.",
    enumValues: ['DRAFT', 'PENDING_REVIEW', 'ARCHIVED', 'SOLD'],
    aliases: ['listingstatus', 'vintraxstatus'],
  },
  {
    key: 'sale_channel',
    required: false,
    description: 'How the vehicle sells.',
    enumValues: SALE_CHANNELS,
    aliases: ['channel', 'salestype', 'saletype'],
  },
] as const;

export const INVENTORY_CSV_HEADERS = INVENTORY_CSV_COLUMNS.map((column) => column.key);

export const REQUIRED_INVENTORY_CSV_HEADERS = INVENTORY_CSV_COLUMNS.filter(
  (column) => column.required,
).map((column) => column.key);

/**
 * Header text as written by a spreadsheet, reduced to a comparison key.
 *
 * Case, spaces, underscores, hyphens and `#` all disappear, so `Stock #`,
 * `stock_number` and `STOCKNUMBER` are the same key. This is deliberately not
 * fuzzy matching: it is exact matching after a documented normalisation, which
 * means a header either maps or it is reported as unrecognised. A Levenshtein
 * guess that silently lands `price_msrp` on `price_cad` would be worse than
 * telling the dealer the column was not recognised.
 */
export function normaliseHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[\s_\-#().]/g, '')
    .trim();
}

/** Comparison key → canonical column key. Built from the column table above. */
export const HEADER_ALIASES: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const column of INVENTORY_CSV_COLUMNS) {
    map.set(normaliseHeader(column.key), column.key);
    for (const alias of column.aliases ?? []) {
      map.set(normaliseHeader(alias), column.key);
    }
  }
  return map;
})();

const IGNORED_HEADER_KEYS: ReadonlySet<string> = new Set(
  IGNORED_OWNERSHIP_COLUMNS.map(normaliseHeader),
);

/** How one header in an uploaded file was interpreted. */
export type HeaderResolution =
  | { kind: 'mapped'; column: string }
  | { kind: 'ignored-ownership' }
  | { kind: 'unrecognised' };

export function resolveHeader(header: string): HeaderResolution {
  const key = normaliseHeader(header);
  if (key.length === 0) return { kind: 'unrecognised' };
  if (IGNORED_HEADER_KEYS.has(key)) return { kind: 'ignored-ownership' };
  const column = HEADER_ALIASES.get(key);
  return column ? { kind: 'mapped', column } : { kind: 'unrecognised' };
}

// --- Value normalisation -----------------------------------------------------
//
// Every normaliser returns `null` for "absent" and throws nothing. A value that
// cannot be read is reported as an error against the row rather than coerced:
// turning `12345` into a VIN or `n/a` into `0` would be the importer inventing
// inventory data, which is the one thing it must never do.

/** Trims, and treats the spreadsheet spellings of "empty" as absent. */
export function normaliseText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.replace(/^\uFEFF/, '').trim();
  if (trimmed.length === 0) return null;
  // Dealership exports write these where a human means "nothing".
  if (/^(n\/a|na|null|none|-|--)$/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * A whole number written the way a dealership system writes it: `29,999`,
 * `$29,999`, `29999.00`, `48,900 km`.
 *
 * Returns `undefined` when the text is present but not a number, which the
 * caller reports as an error. A fractional value is refused rather than
 * rounded — a price of `29999.50` is a sign the column is not what we think it
 * is, and silently dropping fifty cents is how a dealer loses trust in the
 * importer.
 */
export function normaliseInteger(value: string | undefined): number | null | undefined {
  const text = normaliseText(value);
  if (text === null) return null;

  const cleaned = text
    .replace(/^\$/, '')
    .replace(/(cad|usd|km|kms|kilometres|kilometers|miles|mi)\.?$/i, '')
    .replace(/[\s,'’]/g, '')
    .trim();

  if (!/^-?\d+(\.0+)?$/.test(cleaned)) return undefined;
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** A decimal, for engine displacement. `2.5L` and `2,5` both read as 2.5. */
export function normaliseDecimal(value: string | undefined): number | null | undefined {
  const text = normaliseText(value);
  if (text === null) return null;

  const cleaned = text.replace(/l$/i, '').replace(/\s/g, '').replace(',', '.').trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A VIN, upper-cased.
 *
 * Case is formatting, so `1hgcm82633a123456` becoming uppercase is a safe
 * normalisation. Length and alphabet are meaning, so a 5-character value stays
 * wrong and is reported — never padded, never accepted.
 */
export function normaliseVin(value: string | undefined): string | null {
  const text = normaliseText(value);
  if (text === null) return null;
  return text.replace(/\s/g, '').toUpperCase();
}

export function isValidVin(vin: string): boolean {
  return VIN_PATTERN.test(vin);
}

/**
 * Maps free text onto one of an enumeration's values.
 *
 * Exact match after normalisation, plus a documented synonym table. Anything
 * else is an error: a CSV must not be able to invent an enum value, and a
 * "closest match" on a fuel type is how an electric car gets listed as diesel.
 */
export function normaliseEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  synonyms: Readonly<Record<string, T>> = {},
): T | null | undefined {
  const text = normaliseText(value);
  if (text === null) return null;

  const key = text.toLowerCase().replace(/[\s_\-/]/g, '');
  const direct = allowed.find((candidate) => candidate.toLowerCase().replace(/_/g, '') === key);
  if (direct) return direct;

  return synonyms[key] ?? undefined;
}

/**
 * Synonyms real dealership exports use, per enumeration.
 *
 * Kept explicit and small. Every entry here is a claim that two spellings mean
 * the same thing, and each one is a place a wrong guess becomes wrong data.
 */
export const ENUM_SYNONYMS = {
  condition: {
    new: 'NEW',
    used: 'USED',
    preowned: 'USED',
    secondhand: 'USED',
    cpo: 'CERTIFIED_PRE_OWNED',
    certified: 'CERTIFIED_PRE_OWNED',
    certifiedpreowned: 'CERTIFIED_PRE_OWNED',
    certifiedusedvehicle: 'CERTIFIED_PRE_OWNED',
    salvage: 'SALVAGE',
    rebuilt: 'SALVAGE',
  },
  bodyType: {
    saloon: 'SEDAN',
    fourdoor: 'SEDAN',
    crossover: 'SUV',
    sportutility: 'SUV',
    sportutilityvehicle: 'SUV',
    pickup: 'TRUCK',
    pickuptruck: 'TRUCK',
    twodoor: 'COUPE',
    hatch: 'HATCHBACK',
    liftback: 'HATCHBACK',
    minivan: 'MINIVAN',
    estate: 'WAGON',
    stationwagon: 'WAGON',
    touring: 'WAGON',
    cabriolet: 'CONVERTIBLE',
    roadster: 'CONVERTIBLE',
    cargovan: 'VAN',
    panelvan: 'VAN',
  },
  transmission: {
    auto: 'AUTOMATIC',
    automatic: 'AUTOMATIC',
    at: 'AUTOMATIC',
    manual: 'MANUAL',
    standard: 'MANUAL',
    stick: 'MANUAL',
    mt: 'MANUAL',
    cvt: 'CVT',
    continuouslyvariable: 'CVT',
    dct: 'DUAL_CLUTCH',
    dsg: 'DUAL_CLUTCH',
    dualclutch: 'DUAL_CLUTCH',
  },
  fuelType: {
    gas: 'GASOLINE',
    gasoline: 'GASOLINE',
    petrol: 'GASOLINE',
    unleaded: 'GASOLINE',
    diesel: 'DIESEL',
    hybrid: 'HYBRID',
    hev: 'HYBRID',
    phev: 'PLUG_IN_HYBRID',
    pluginhybrid: 'PLUG_IN_HYBRID',
    electric: 'ELECTRIC',
    ev: 'ELECTRIC',
    bev: 'ELECTRIC',
    battery: 'ELECTRIC',
    hydrogen: 'HYDROGEN',
    fuelcell: 'HYDROGEN',
  },
  drivetrain: {
    fwd: 'FWD',
    frontwheeldrive: 'FWD',
    front: 'FWD',
    rwd: 'RWD',
    rearwheeldrive: 'RWD',
    rear: 'RWD',
    awd: 'AWD',
    allwheeldrive: 'AWD',
    all: 'AWD',
    '4wd': 'FOUR_WHEEL_DRIVE',
    '4x4': 'FOUR_WHEEL_DRIVE',
    fourwheeldrive: 'FOUR_WHEEL_DRIVE',
    fourbyfour: 'FOUR_WHEEL_DRIVE',
  },
} as const;

/** Pipe- or semicolon-separated, because a comma cannot survive a CSV cell cleanly. */
export function normaliseFeatures(value: string | undefined): string[] | null {
  const text = normaliseText(value);
  if (text === null) return null;
  const parts = text
    .split(/[|;]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return Array.from(new Set(parts)).slice(0, 60);
}

/** Model years the importer will accept, as a closed range. */
export function inventoryYearRange(now: Date = new Date()): { min: number; max: number } {
  return { min: MIN_MODEL_YEAR, max: maxModelYear(now) };
}

// --- Result shapes -----------------------------------------------------------

/** One row's verdict, as shown in the preview table and returned by a confirm. */
export interface InventoryRowResult {
  /** 1-based line number in the uploaded file, counting the header as line 1. */
  row: number;
  action: InventoryRowAction;
  vin: string | null;
  stockNumber: string | null;
  /** Year, make, model and trim, for a human scanning the table. */
  vehicle: string | null;
  /** Canonical field names this row would change. Empty for CREATE and ERROR. */
  changes: string[];
  errors: string[];
  /** Non-blocking notes, such as a VIN another seller also lists. */
  warnings: string[];
  /** Set once the row has actually been written. */
  vehicleId?: string;
}

export interface InventoryImportSummary {
  totalRows: number;
  create: number;
  update: number;
  unchanged: number;
  errors: number;
}

export interface InventoryImportPlan {
  schemaVersion: number;
  /** Hex SHA-256 of the uploaded bytes. Confirm must present the same file. */
  fileHash: string;
  filename: string;
  summary: InventoryImportSummary;
  rows: InventoryRowResult[];
  /** Headers that mapped, in the order the file listed them. */
  mappedColumns: string[];
  /** Ownership columns that were present and deliberately ignored. */
  ignoredColumns: string[];
  /** Headers that matched nothing. Not an error; the data is skipped. */
  unrecognisedColumns: string[];
  /**
   * Where rows that name no city or province are placed.
   *
   * Reported rather than left implicit: a dealer management system exports one
   * location for the whole rooftop or none at all, so most real files say
   * nothing about it, and a dealer is entitled to see which city 200 new
   * listings are about to claim before confirming. Either half may be null,
   * which is why a row that needs it and has neither is refused in the preview.
   */
  defaultLocation: InventoryImportLocation;
}

/** A city and province to apply only where the file itself gives none. */
export interface InventoryImportLocation {
  city: string | null;
  province: Province | null;
}

export interface InventoryImportResult {
  importId: string;
  status: InventoryImportStatus;
  summary: InventoryImportSummary;
  rows: InventoryRowResult[];
}

export interface InventoryImportRecord {
  id: string;
  filename: string;
  schemaVersion: number;
  status: InventoryImportStatus;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  errorCount: number;
  initiatedByEmail: string | null;
  createdAt: string;
  completedAt: string | null;
}
