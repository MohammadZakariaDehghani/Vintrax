/**
 * Domain vocabulary for the Vintrax marketplace.
 *
 * These constants are the single source of truth for the values the API accepts
 * and the frontend renders. The Prisma enums mirror them exactly, so a change
 * here is a schema change and needs a migration.
 */

// --- Identity and access -----------------------------------------------------

export const USER_ROLES = [
  'BUYER',
  'SELLER',
  'DEALER',
  'INSPECTOR',
  'ADMIN',
  'SUPER_ADMIN',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Roles permitted to publish vehicle listings. */
export const SELLER_ROLES = ['SELLER', 'DEALER'] as const;
export type SellerRole = (typeof SELLER_ROLES)[number];

/** Roles with platform administration capability. */
export const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const;

/**
 * Fine-grained permissions. Roles map onto sets of these, so a capability can be
 * granted without inventing a new role. Checked by the permissions guard.
 */
export const PERMISSIONS = [
  'vehicle:read',
  'vehicle:write',
  'vehicle:publish',
  'vehicle:delete',
  'auction:read',
  'auction:create',
  'auction:manage',
  'bid:place',
  'inspection:read',
  'inspection:write',
  'dealer:read',
  'dealer:manage',
  'dealer:verify',
  'user:read',
  'user:manage',
  'payment:read',
  'payment:manage',
  'report:read',
  // How the storefront presents itself — the body-type photographs, and
  // whatever joins them. Deliberately separate from `settings:manage`, which
  // covers platform configuration and stays with super admins: changing a
  // picture on the home page and changing a fee schedule are not the same
  // power, and a moderator needs the first without the second.
  'content:manage',
  'settings:manage',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Which permissions each role carries. SUPER_ADMIN implicitly holds all. */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  BUYER: ['vehicle:read', 'auction:read', 'bid:place', 'inspection:read'],
  SELLER: [
    'vehicle:read',
    'vehicle:write',
    'vehicle:publish',
    'vehicle:delete',
    'auction:read',
    'auction:create',
    'bid:place',
    'inspection:read',
    // Recording that funds arrived is the seller's side of a sale. Ownership of
    // the specific order is still checked in the service.
    'payment:manage',
  ],
  DEALER: [
    'vehicle:read',
    'vehicle:write',
    'vehicle:publish',
    'vehicle:delete',
    'auction:read',
    'auction:create',
    'bid:place',
    'inspection:read',
    'dealer:read',
    'payment:read',
    'payment:manage',
    'report:read',
  ],
  INSPECTOR: ['vehicle:read', 'inspection:read', 'inspection:write'],
  ADMIN: [
    'vehicle:read',
    'vehicle:write',
    'vehicle:publish',
    'vehicle:delete',
    'auction:read',
    'auction:create',
    'auction:manage',
    'inspection:read',
    'inspection:write',
    'dealer:read',
    'dealer:manage',
    'dealer:verify',
    'user:read',
    'user:manage',
    'payment:read',
    'payment:manage',
    'report:read',
    'audit:read',
    'content:manage',
  ],
  SUPER_ADMIN: PERMISSIONS,
};

/**
 * Which roles an actor may assign, when creating an account or changing one.
 *
 * The rule is that you cannot mint a peer or a superior. A super admin may
 * assign anything; an admin may assign every non-administrative role but
 * neither ADMIN nor SUPER_ADMIN; nobody else may assign at all.
 *
 * This is the anti-escalation rule, and it is deliberately not "the roles whose
 * permissions are a subset of your own". That reading looks principled and is
 * wrong here: ADMIN does not carry `bid:place`, because the operator of a
 * marketplace should not be bidding in it, so a subset rule would stop an admin
 * creating an ordinary buyer.
 */
export function assignableRoles(actorRole: UserRole): readonly UserRole[] {
  if (actorRole === 'SUPER_ADMIN') return USER_ROLES;
  if (actorRole === 'ADMIN') return ['BUYER', 'SELLER', 'DEALER', 'INSPECTOR'];
  return [];
}

export function canAssignRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return assignableRoles(actorRole).includes(targetRole);
}

/**
 * Whether an actor may administer the account of someone holding `targetRole`.
 *
 * An admin may not act on another administrator — only a super admin may. This
 * is what stops two admins from being able to suspend or demote each other, and
 * it matches the check the status endpoint has always made.
 */
export function canAdministerUser(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'SUPER_ADMIN') return true;
  if (actorRole !== 'ADMIN') return false;
  return targetRole !== 'ADMIN' && targetRole !== 'SUPER_ADMIN';
}

/**
 * Editorial posts.
 *
 * `PUBLISHED` is the only state a visitor can reach. `ARCHIVED` exists so a
 * post can be taken off the site without deleting the writing, which is what
 * an author actually wants when a piece goes stale.
 */
export const ARTICLE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const USER_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const DEALER_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED'] as const;
export type DealerStatus = (typeof DEALER_STATUSES)[number];

// --- Vehicles ----------------------------------------------------------------

export const LISTING_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'IN_AUCTION',
  'SOLD',
  'ARCHIVED',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/**
 * Statuses a seller may put a listing into themselves.
 *
 * `ACTIVE` is deliberately absent: publishing is a moderation decision, so it
 * is reached through the admin moderation endpoint and never by a seller
 * writing the field. `IN_AUCTION` is absent because it describes a running
 * auction rather than a choice.
 *
 * `SOLD` is here because cars are sold off the platform. A dealer who sells
 * one on the forecourt needs to take it off the market, and marking it sold is
 * more honest than archiving it — the vehicle stays visible with its outcome,
 * and time-to-sale reporting keeps working. Nothing about it is a moderation
 * bypass: it removes a listing from sale rather than putting one up.
 */
export const SELLER_SETTABLE_LISTING_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ARCHIVED',
  'SOLD',
] as const;
export type SellerSettableListingStatus = (typeof SELLER_SETTABLE_LISTING_STATUSES)[number];

/** Statuses a listing may be created in. A new listing is never born published. */
export const CREATABLE_LISTING_STATUSES = ['DRAFT', 'PENDING_REVIEW'] as const;

/**
 * Status transitions a seller may perform, keyed by the listing's current
 * status. Anything absent here needs an administrator or a domain event.
 */
export const SELLER_STATUS_TRANSITIONS: Record<
  ListingStatus,
  readonly SellerSettableListingStatus[]
> = {
  DRAFT: ['PENDING_REVIEW', 'ARCHIVED', 'SOLD'],
  PENDING_REVIEW: ['DRAFT', 'SOLD'],
  // Unpublishing to edit is one step, not two. Returning to DRAFT costs the
  // seller their approval — re-publishing means going through review again —
  // which is the whole point, so there is no reason to make it awkward.
  ACTIVE: ['DRAFT', 'ARCHIVED', 'SOLD'],
  ARCHIVED: ['DRAFT', 'SOLD'],
  // A running auction is not the seller's to end by relabelling the vehicle —
  // bidders are committed to it. Cancel the auction first.
  IN_AUCTION: [],
  // Reopening a sold listing is allowed, because "sold" is sometimes a
  // mistake or a deal that fell through. The service refuses when a real
  // order exists for the vehicle, so a car someone has paid for cannot be
  // put back on the market.
  SOLD: ['DRAFT'],
};

/** How a vehicle is being sold. Fixed price, auction, or accepting offers. */
export const SALE_CHANNELS = ['FIXED_PRICE', 'AUCTION', 'ACCEPTING_OFFERS'] as const;
export type SaleChannel = (typeof SALE_CHANNELS)[number];

export const VEHICLE_CONDITIONS = ['NEW', 'USED', 'CERTIFIED_PRE_OWNED', 'SALVAGE'] as const;
export type VehicleCondition = (typeof VEHICLE_CONDITIONS)[number];

export const BODY_TYPES = [
  'SEDAN',
  'SUV',
  'TRUCK',
  'COUPE',
  'HATCHBACK',
  'MINIVAN',
  'WAGON',
  'CONVERTIBLE',
  'VAN',
] as const;
export type BodyType = (typeof BODY_TYPES)[number];

/**
 * Body types as a shopper would name a group of them.
 *
 * The enum member is singular because a vehicle has one body type; a shortcut
 * that leads to every SUV in the country is labelled "SUVs". Spelled out here
 * rather than derived, because "Station wagons" is not "Wagon" plus an s, and
 * because English pluralisation is not a rule worth writing in code.
 */
export const BODY_TYPE_PLURAL_LABELS: Record<BodyType, string> = {
  SEDAN: 'Sedans',
  SUV: 'SUVs',
  TRUCK: 'Trucks',
  COUPE: 'Coupes',
  HATCHBACK: 'Hatchbacks',
  MINIVAN: 'Minivans',
  WAGON: 'Station wagons',
  CONVERTIBLE: 'Convertibles',
  VAN: 'Vans',
};

/**
 * `OTHER` is not a catch-all for bad data — it is a real category this list was
 * missing. A battery-electric car has a single-speed reduction gear rather than
 * any of the four above, and dealership feeds legitimately say "Other" for it.
 * The CSV importer records that value; it never guesses one. See D-030.
 */
export const TRANSMISSIONS = ['AUTOMATIC', 'MANUAL', 'CVT', 'DUAL_CLUTCH', 'OTHER'] as const;
export type Transmission = (typeof TRANSMISSIONS)[number];

export const FUEL_TYPES = [
  'GASOLINE',
  'DIESEL',
  'HYBRID',
  'PLUG_IN_HYBRID',
  'ELECTRIC',
  'HYDROGEN',
] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

/** `OTHER` for the drivetrains that are none of these four — see TRANSMISSIONS. */
export const DRIVETRAINS = ['FWD', 'RWD', 'AWD', 'FOUR_WHEEL_DRIVE', 'OTHER'] as const;
export type Drivetrain = (typeof DRIVETRAINS)[number];

export const VEHICLE_DOCUMENT_TYPES = [
  'REGISTRATION',
  'TITLE',
  'CARFAX',
  'SERVICE_RECORD',
  'SAFETY_CERTIFICATE',
  'BILL_OF_SALE',
  'OTHER',
] as const;
export type VehicleDocumentType = (typeof VEHICLE_DOCUMENT_TYPES)[number];

// --- Inspections -------------------------------------------------------------

export const INSPECTION_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

/**
 * Overall condition grade, following the 1–5 scale common in wholesale auto
 * auctions where 5 is showroom and 1 is rough.
 */
export const CONDITION_GRADES = ['GRADE_1', 'GRADE_2', 'GRADE_3', 'GRADE_4', 'GRADE_5'] as const;
export type ConditionGrade = (typeof CONDITION_GRADES)[number];

/** Areas assessed during an inspection. Each receives a rating and notes. */
export const INSPECTION_SECTIONS = [
  'EXTERIOR',
  'INTERIOR',
  'ENGINE',
  'TRANSMISSION',
  'BRAKES',
  'SUSPENSION',
  'ELECTRICAL',
  'TIRES',
  'FRAME',
  'ROAD_TEST',
] as const;
export type InspectionSection = (typeof INSPECTION_SECTIONS)[number];

export const SECTION_RATINGS = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'NOT_APPLICABLE'] as const;
export type SectionRating = (typeof SECTION_RATINGS)[number];

// --- Auctions ----------------------------------------------------------------

export const AUCTION_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'LIVE',
  'ENDED',
  'SETTLED',
  'CANCELLED',
] as const;
export type AuctionStatus = (typeof AUCTION_STATUSES)[number];

export const BID_STATUSES = ['ACTIVE', 'OUTBID', 'WINNING', 'WON', 'LOST', 'RETRACTED'] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

/**
 * Minimum increment by price band, in whole dollars. Prevents one-dollar bid
 * wars on expensive lots while keeping cheap lots accessible.
 */
export const BID_INCREMENT_BANDS: ReadonlyArray<{ upTo: number; increment: number }> = [
  { upTo: 5_000, increment: 100 },
  { upTo: 15_000, increment: 250 },
  { upTo: 30_000, increment: 500 },
  { upTo: 75_000, increment: 1_000 },
  { upTo: Number.MAX_SAFE_INTEGER, increment: 2_500 },
];

/** The smallest legal next bid above `currentPrice`. */
export function minimumBidIncrement(currentPrice: number): number {
  const band = BID_INCREMENT_BANDS.find((candidate) => currentPrice < candidate.upTo);
  return band?.increment ?? 2_500;
}

/**
 * A bid inside this window extends the auction, so a lot cannot be won by
 * sniping in the final seconds. Standard practice in online vehicle auctions.
 */
export const ANTI_SNIPE_WINDOW_SECONDS = 120;
export const ANTI_SNIPE_EXTENSION_SECONDS = 120;

// --- Commerce ----------------------------------------------------------------

export const PAYMENT_STATUSES = [
  'PENDING',
  'AUTHORIZED',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'FAILED',
  'CANCELLED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['CARD', 'BANK_TRANSFER', 'FINANCING', 'CASH_ON_PICKUP'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const TRANSACTION_STATUSES = [
  'INITIATED',
  'AWAITING_PAYMENT',
  'PAID',
  'AWAITING_DELIVERY',
  'COMPLETED',
  'CANCELLED',
  'DISPUTED',
] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

/** Platform commission on a completed sale, as a fraction of the hammer price. */
export const PLATFORM_FEE_RATE = 0.05;
/** Commission floor and ceiling in whole dollars, so small lots stay viable. */
export const PLATFORM_FEE_MIN = 150;
export const PLATFORM_FEE_MAX = 2_500;

export function calculatePlatformFee(saleAmount: number): number {
  const raw = Math.round(saleAmount * PLATFORM_FEE_RATE);
  return Math.min(PLATFORM_FEE_MAX, Math.max(PLATFORM_FEE_MIN, raw));
}

// --- Notifications and messaging ---------------------------------------------

export const NOTIFICATION_TYPES = [
  'BID_PLACED',
  'OUTBID',
  'AUCTION_WON',
  'AUCTION_LOST',
  'AUCTION_STARTING',
  'AUCTION_ENDING',
  'LISTING_APPROVED',
  'LISTING_REJECTED',
  'INSPECTION_COMPLETED',
  'MESSAGE_RECEIVED',
  'PAYMENT_RECEIVED',
  'PAYMENT_DUE',
  'DEALER_VERIFIED',
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'SMS'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

// --- Geography ---------------------------------------------------------------

/** Vintrax launches in Canada, so location is modelled as province plus city. */
export const PROVINCES = [
  'AB',
  'BC',
  'MB',
  'NB',
  'NL',
  'NS',
  'NT',
  'NU',
  'ON',
  'PE',
  'QC',
  'SK',
  'YT',
] as const;
export type Province = (typeof PROVINCES)[number];

export const PROVINCE_LABELS: Record<Province, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

export const ADDRESS_TYPES = ['BILLING', 'SHIPPING', 'BUSINESS', 'PICKUP'] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];

// --- Search ------------------------------------------------------------------

export const LISTING_SORTS = [
  'RELEVANCE',
  'NEWEST',
  'PRICE_ASC',
  'PRICE_DESC',
  'MILEAGE_ASC',
  'YEAR_DESC',
  'ENDING_SOON',
] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];

// --- Constraints -------------------------------------------------------------

/** Oldest model year a listing may claim; guards against typos like `19995`. */
export const MIN_MODEL_YEAR = 1900;

/** Listings may be posted up to one model year ahead of the current year. */
export const maxModelYear = (now: Date = new Date()): number => now.getUTCFullYear() + 1;

export const MAX_LISTING_IMAGES = 30;
export const MAX_INSPECTION_IMAGES = 60;
export const MAX_VEHICLE_DOCUMENTS = 20;

/** Standard 17-character VIN; I, O and Q are excluded by the standard. */
export const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

// --- Display -----------------------------------------------------------------

/**
 * Enum values whose generic title-cased form reads wrong — acronyms that must
 * stay uppercase, and compounds that need a hyphen.
 */
const LABEL_OVERRIDES: Record<string, string> = {
  SUV: 'SUV',
  CVT: 'CVT',
  FWD: 'FWD',
  RWD: 'RWD',
  AWD: 'AWD',
  VIN: 'VIN',
  SMS: 'SMS',
  FOUR_WHEEL_DRIVE: '4WD',
  DUAL_CLUTCH: 'Dual-clutch',
  PLUG_IN_HYBRID: 'Plug-in hybrid',
  CERTIFIED_PRE_OWNED: 'Certified pre-owned',
  PRIVATE_SELLER: 'Private seller',
  SUPER_ADMIN: 'Super admin',
  IN_APP: 'In-app',
  NOT_APPLICABLE: 'Not applicable',
  GRADE_1: 'Grade 1',
  GRADE_2: 'Grade 2',
  GRADE_3: 'Grade 3',
  GRADE_4: 'Grade 4',
  GRADE_5: 'Grade 5',
};

/**
 * Human-readable label for an enum value, used by filter controls and detail
 * pages. Falls back to sentence case: SEDAN -> "Sedan".
 */
export const labelize = (value: string): string => {
  const override = LABEL_OVERRIDES[value];
  if (override) return override;

  return value
    .split('_')
    .map((word, index) =>
      index === 0 ? word.charAt(0) + word.slice(1).toLowerCase() : word.toLowerCase(),
    )
    .join(' ');
};

/**
 * What one entry on a vehicle's history timeline says happened.
 *
 * Kept small and concrete. These are the lines that actually appear on a
 * Canadian history report, and a longer list would invite a seller to reach for
 * a category that sounds better than the one that fits.
 */
export const VEHICLE_HISTORY_EVENT_KINDS = [
  'REGISTERED',
  'SOLD',
  'SERVICE',
  'CLAIM',
  'NO_CLAIMS',
  'INSPECTION',
  'SAFETY_CERTIFIED',
  'RECALL',
  'OTHER',
] as const;
export type VehicleHistoryEventKind = (typeof VEHICLE_HISTORY_EVENT_KINDS)[number];

export const VEHICLE_HISTORY_EVENT_LABELS: Record<VehicleHistoryEventKind, string> = {
  REGISTERED: 'Registered',
  SOLD: 'Sold',
  SERVICE: 'Service',
  CLAIM: 'Insurance claim',
  NO_CLAIMS: 'No claims reported',
  INSPECTION: 'Inspection',
  SAFETY_CERTIFIED: 'Safety certified',
  RECALL: 'Recall',
  OTHER: 'Other',
};

/**
 * The kinds that are bad news.
 *
 * Marked so the timeline can colour them, and so a seller cannot hide a claim
 * by choosing a gentler category: the styling follows the kind, not the words
 * the seller typed next to it.
 */
export const ADVERSE_HISTORY_EVENT_KINDS: readonly VehicleHistoryEventKind[] = ['CLAIM', 'RECALL'];
