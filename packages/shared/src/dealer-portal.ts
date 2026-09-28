import { z } from 'zod';
import {
  LISTING_STATUSES,
  MIN_MODEL_YEAR,
  maxModelYear,
  type ListingStatus,
  type Province,
} from './domain';
import { MAX_PAGE_SIZE } from './schemas';
import type { OptimizedImage } from './contracts';

/**
 * The dealer portal: inventory management, vehicle costs and the help
 * assistant.
 *
 * Everything here is private to the seller who owns the vehicles. None of these
 * shapes is ever returned by a public or buyer-facing route, and none of the
 * inputs names an owner — the API takes the owner from the session.
 */

// --- Where a vehicle came from -----------------------------------------------

/** Mirrors the Prisma `VehicleSource` enum. Set by the server, never by a client. */
export const VEHICLE_SOURCES = ['MANUAL', 'CSV_IMPORT'] as const;
export type VehicleSource = (typeof VEHICLE_SOURCES)[number];

export const VEHICLE_SOURCE_LABELS: Record<VehicleSource, string> = {
  MANUAL: 'Added by hand',
  CSV_IMPORT: 'CSV import',
};

// --- Inventory list -----------------------------------------------------------

export const DEALER_INVENTORY_SORTS = [
  'updated_desc',
  'updated_asc',
  'price_desc',
  'price_asc',
  'year_desc',
  'year_asc',
  'mileage_asc',
  'mileage_desc',
  'created_desc',
] as const;
export type DealerInventorySort = (typeof DEALER_INVENTORY_SORTS)[number];

export const DEALER_INVENTORY_SORT_LABELS: Record<DealerInventorySort, string> = {
  updated_desc: 'Recently updated',
  updated_asc: 'Least recently updated',
  price_desc: 'Price: high to low',
  price_asc: 'Price: low to high',
  year_desc: 'Year: newest first',
  year_asc: 'Year: oldest first',
  mileage_asc: 'Mileage: lowest first',
  mileage_desc: 'Mileage: highest first',
  created_desc: 'Recently added',
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

const optionalInt = (min: number, max: number) =>
  z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.coerce.number().int().min(min).max(max).optional(),
  );

/**
 * Filters over the caller's own inventory. Everything is optional; nothing in
 * here can widen the result past the caller's own vehicles, because the owner
 * is never one of the filters.
 */
export const dealerInventoryFilterSchema = z
  .object({
    q: optionalText(120),
    status: z.enum(LISTING_STATUSES).optional(),
    make: optionalText(60),
    model: optionalText(60),
    yearMin: optionalInt(MIN_MODEL_YEAR, maxModelYear()),
    yearMax: optionalInt(MIN_MODEL_YEAR, maxModelYear()),
    priceMin: optionalInt(0, 10_000_000),
    priceMax: optionalInt(0, 10_000_000),
    source: z.enum(VEHICLE_SOURCES).optional(),
  })
  .refine((data) => !data.yearMin || !data.yearMax || data.yearMin <= data.yearMax, {
    message: 'The first year must not be after the last.',
    path: ['yearMin'],
  })
  .refine(
    (data) =>
      data.priceMin === undefined || data.priceMax === undefined || data.priceMin <= data.priceMax,
    { message: 'The minimum price must not be above the maximum.', path: ['priceMin'] },
  );
export type DealerInventoryFilter = z.infer<typeof dealerInventoryFilterSchema>;

export const dealerInventoryQuerySchema = dealerInventoryFilterSchema.and(
  z.object({
    sort: z.enum(DEALER_INVENTORY_SORTS).default('updated_desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  }),
);
export type DealerInventoryQuery = z.infer<typeof dealerInventoryQuerySchema>;

/**
 * The most ids "select every matching vehicle" returns. The bulk endpoints
 * take at most `MAX_BULK_VEHICLE_IDS` (200) at a time, so the client applies a
 * larger selection in batches of that size.
 */
export const MAX_INVENTORY_SELECTION = 2000;

/** One row of the dealer inventory table. Carries the private fields the public summary does not. */
export interface DealerInventoryItem {
  id: string;
  slug: string;
  title: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  vin: string | null;
  stockNumber: string | null;
  mileageKm: number;
  priceCad: number;
  previousPriceCad: number | null;
  status: ListingStatus;
  source: VehicleSource;
  city: string;
  province: Province;
  primaryImageUrl: string | null;
  /** The main photo's renditions, where it has been processed. */
  primaryImage: OptimizedImage | null;
  imageCount: number;
  /** Every recorded cost on the vehicle, in cents. Zero when none are recorded. */
  totalCostCents: number;
  /** How many cost entries make up that total. */
  costCount: number;
  /** Whether the vehicle is currently in a live or scheduled auction, which blocks deletion. */
  inLiveAuction: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DealerInventoryPage {
  items: DealerInventoryItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** The headline numbers over the caller's whole inventory, computed on the server. */
export interface DealerInventoryStats {
  total: number;
  active: number;
  sold: number;
  draft: number;
  inReview: number;
  inAuction: number;
  archived: number;
  /**
   * Sum of asking prices of vehicles still for sale or being prepared: every
   * status except SOLD and ARCHIVED. In whole dollars, like `priceCad`.
   */
  inventoryValueCad: number;
  /** Sum of recorded costs on those same vehicles, in cents. */
  inventoryCostCents: number;
  /** Distinct makes in the inventory, for the make filter. */
  makes: string[];
}

export interface DealerInventorySelection {
  ids: string[];
  total: number;
  /** True when more vehicles matched than `MAX_INVENTORY_SELECTION`. */
  truncated: boolean;
}

/** Export of chosen rows. Absent ids means the whole inventory. */
export const dealerInventoryExportSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_INVENTORY_SELECTION).optional(),
});
export type DealerInventoryExportInput = z.infer<typeof dealerInventoryExportSchema>;

// --- Vehicle costs ------------------------------------------------------------

/** Mirrors the Prisma `VehicleCostCategory` enum. */
export const VEHICLE_COST_CATEGORIES = [
  'PURCHASE',
  'AUCTION_FEE',
  'TRANSPORTATION',
  'INSPECTION',
  'MECHANICAL_REPAIR',
  'BODY_REPAIR',
  'DETAILING',
  'PARTS',
  'TIRES',
  'CERTIFICATION',
  'LICENSING',
  'OTHER',
] as const;
export type VehicleCostCategory = (typeof VEHICLE_COST_CATEGORIES)[number];

export const VEHICLE_COST_CATEGORY_LABELS: Record<VehicleCostCategory, string> = {
  PURCHASE: 'Purchase cost',
  AUCTION_FEE: 'Auction fee',
  TRANSPORTATION: 'Transportation',
  INSPECTION: 'Inspection',
  MECHANICAL_REPAIR: 'Mechanical repair',
  BODY_REPAIR: 'Body repair',
  DETAILING: 'Detailing',
  PARTS: 'Parts',
  TIRES: 'Tires',
  CERTIFICATION: 'Certification',
  LICENSING: 'Licensing',
  OTHER: 'Other',
};

/**
 * The categories the cost overview counts as repair (reconditioning): work
 * and materials that go into the car itself. Everything that is neither the
 * purchase nor a repair — fees, transport, inspection, detailing,
 * certification, licensing, other — is an "other cost".
 */
export const REPAIR_COST_CATEGORIES: readonly VehicleCostCategory[] = [
  'MECHANICAL_REPAIR',
  'BODY_REPAIR',
  'PARTS',
  'TIRES',
];

export type CostGroup = 'PURCHASE' | 'REPAIR' | 'OTHER';

export function costGroupOf(category: VehicleCostCategory): CostGroup {
  if (category === 'PURCHASE') return 'PURCHASE';
  return REPAIR_COST_CATEGORIES.includes(category) ? 'REPAIR' : 'OTHER';
}

/** One million dollars, in cents. No single invoice line on a used car is larger. */
export const MAX_COST_CENTS = 100_000_000;

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-28.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'That is not a real date.');

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

/**
 * A cost as the dealer enters it. `amountCents` is an integer number of cents
 * — the form converts "450.75" — so no floating-point money reaches the API.
 * There is deliberately no vehicle or dealer field: the vehicle comes from the
 * URL and is checked against the session, and the dealer is the session.
 */
export const vehicleCostInputSchema = z
  .object({
    category: z.enum(VEHICLE_COST_CATEGORIES),
    description: nullableText(160),
    amountCents: z
      .number()
      .int('Amounts are in whole cents.')
      .positive('The amount must be more than zero.')
      .max(MAX_COST_CENTS, 'That amount is too large for one entry.'),
    incurredOn: calendarDate,
    vendor: nullableText(120),
    reference: nullableText(80),
    notes: nullableText(2000),
  })
  .strict();
export type VehicleCostInput = z.infer<typeof vehicleCostInputSchema>;

export const updateVehicleCostSchema = vehicleCostInputSchema
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'Change at least one field.' });
export type UpdateVehicleCostInput = z.infer<typeof updateVehicleCostSchema>;

export interface VehicleCostEntry {
  id: string;
  vehicleId: string;
  category: VehicleCostCategory;
  description: string | null;
  amountCents: number;
  /** `YYYY-MM-DD`. */
  incurredOn: string;
  vendor: string | null;
  reference: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleCostTotals {
  purchaseCents: number;
  /** Everything except the purchase: repairs and other costs together. */
  additionalCents: number;
  repairCents: number;
  otherCents: number;
  totalCents: number;
  /**
   * Asking price less total cost, in cents. Null when no cost is recorded, since
   * a margin over nothing would just be the price. Not profit: it ignores
   * overheads, commissions and taxes, and the price is the listed one.
   */
  grossMarginCents: number | null;
}

/** Adds up a vehicle's cost entries. The one definition the API and the UI both use. */
export function summariseVehicleCosts(
  entries: ReadonlyArray<Pick<VehicleCostEntry, 'category' | 'amountCents'>>,
  priceCad: number,
): VehicleCostTotals {
  let purchaseCents = 0;
  let repairCents = 0;
  let otherCents = 0;
  for (const entry of entries) {
    const group = costGroupOf(entry.category);
    if (group === 'PURCHASE') purchaseCents += entry.amountCents;
    else if (group === 'REPAIR') repairCents += entry.amountCents;
    else otherCents += entry.amountCents;
  }
  const totalCents = purchaseCents + repairCents + otherCents;
  return {
    purchaseCents,
    additionalCents: repairCents + otherCents,
    repairCents,
    otherCents,
    totalCents,
    grossMarginCents: grossMarginCents(priceCad, totalCents, entries.length > 0),
  };
}

/** Sale (asking) price less total cost, in cents; null when there is no cost to subtract. */
export function grossMarginCents(
  priceCad: number,
  totalCostCents: number,
  hasCosts = totalCostCents > 0,
): number | null {
  if (!hasCosts) return null;
  return priceCad * 100 - totalCostCents;
}

/** The vehicle a cost page is about, with only the fields that page shows. */
export interface VehicleCostVehicle {
  id: string;
  title: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  vin: string | null;
  stockNumber: string | null;
  priceCad: number;
  status: ListingStatus;
  primaryImageUrl: string | null;
}

export interface VehicleCostBreakdown {
  vehicle: VehicleCostVehicle;
  entries: VehicleCostEntry[];
  totals: VehicleCostTotals;
}

export const COST_OVERVIEW_SCOPES = ['IN_STOCK', 'SOLD', 'ALL'] as const;
export type CostOverviewScope = (typeof COST_OVERVIEW_SCOPES)[number];

export const COST_OVERVIEW_SCOPE_LABELS: Record<CostOverviewScope, string> = {
  IN_STOCK: 'In stock',
  SOLD: 'Sold',
  ALL: 'All vehicles',
};

/** Which listing statuses each overview scope covers. */
export const COST_OVERVIEW_SCOPE_STATUSES: Record<CostOverviewScope, readonly ListingStatus[]> = {
  IN_STOCK: ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'IN_AUCTION'],
  SOLD: ['SOLD'],
  ALL: LISTING_STATUSES,
};

export const COST_OVERVIEW_SORTS = [
  'updated_desc',
  'total_desc',
  'total_asc',
  'margin_desc',
  'margin_asc',
] as const;
export type CostOverviewSort = (typeof COST_OVERVIEW_SORTS)[number];

export const COST_OVERVIEW_SORT_LABELS: Record<CostOverviewSort, string> = {
  updated_desc: 'Recently updated',
  total_desc: 'Total cost: high to low',
  total_asc: 'Total cost: low to high',
  margin_desc: 'Gross margin: high to low',
  margin_asc: 'Gross margin: low to high',
};

export const costOverviewQuerySchema = z.object({
  scope: z.enum(COST_OVERVIEW_SCOPES).default('IN_STOCK'),
  q: optionalText(120),
  /** Only vehicles with at least one cost recorded. */
  withCostsOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  sort: z.enum(COST_OVERVIEW_SORTS).default('updated_desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});
export type CostOverviewQuery = z.infer<typeof costOverviewQuerySchema>;

export interface CostOverviewRow extends VehicleCostTotals {
  vehicleId: string;
  title: string;
  vin: string | null;
  stockNumber: string | null;
  status: ListingStatus;
  priceCad: number;
  costCount: number;
  /** When a cost on this vehicle last changed; null when it has none. */
  costsUpdatedAt: string | null;
}

export interface CostOverviewSummary {
  scope: CostOverviewScope;
  vehicleCount: number;
  /** Vehicles in scope with at least one cost recorded. */
  costedVehicleCount: number;
  totalCostCents: number;
  purchaseCents: number;
  repairCents: number;
  otherCents: number;
  /** Total cost divided by the costed vehicles; null when none are costed. */
  averageCostCents: number | null;
  /** Mean gross margin over the costed vehicles; null when none are costed. */
  averageGrossMarginCents: number | null;
}

export interface CostOverviewPage {
  summary: CostOverviewSummary;
  items: CostOverviewRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Formats cents as Canadian dollars, e.g. `$17,650.00`. */
export function formatCents(cents: number, locale = 'en-CA'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Reads a typed amount — "15000", "15,000.50", "$450.75" — as cents. Returns
 * null for anything that is not a plain positive amount with at most two
 * decimals, rather than guessing.
 */
export function parseAmountToCents(text: string): number | null {
  const cleaned = text.trim().replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

// --- Help assistant ------------------------------------------------------------

export const MAX_HELP_MESSAGE_LENGTH = 1000;
/** How many earlier turns the client may send back for context. */
export const MAX_HELP_HISTORY = 8;

export const helpChatSchema = z
  .object({
    message: z.string().trim().min(1, 'Type a question.').max(MAX_HELP_MESSAGE_LENGTH),
    history: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            content: z.string().trim().min(1).max(4000),
          })
          .strict(),
      )
      .max(MAX_HELP_HISTORY)
      .default([]),
    /**
     * The portal page the dealer is on, as a path. Used only to pick relevant
     * help; it is matched against a fixed list and otherwise ignored.
     */
    page: z
      .string()
      .trim()
      .max(200)
      .regex(/^\/[A-Za-z0-9/_-]*$/)
      .optional(),
  })
  .strict();
export type HelpChatInput = z.infer<typeof helpChatSchema>;

export interface HelpSource {
  id: string;
  title: string;
  /** A portal page this article is about, when there is one. */
  href: string | null;
}

export interface HelpChatReply {
  answer: string;
  /** The help articles the answer drew on. Empty for the fallback. */
  sources: HelpSource[];
  /**
   * `ai` when a configured language model wrote the answer from the help
   * articles; `articles` when the answer is the help article itself;
   * `fallback` when nothing in the help covers the question.
   */
  mode: 'ai' | 'articles' | 'fallback';
}

/** The exact words used when the assistant has no answer. */
export const HELP_FALLBACK_ANSWER = 'I’m not sure about that. Please contact Vintrax support.';
