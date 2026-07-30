/**
 * Domain vocabulary for the Atlas marketplace.
 *
 * These constants are the single source of truth for the values the API accepts
 * and the web app renders. The Prisma enums mirror them exactly, so a change
 * here is a schema change and needs a migration.
 */

export const USER_ROLES = ['BUYER', 'PRIVATE_SELLER', 'DEALER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Roles permitted to publish listings. Buyers browse and message only. */
export const SELLER_ROLES = ['PRIVATE_SELLER', 'DEALER'] as const;
export type SellerRole = (typeof SELLER_ROLES)[number];

export const LISTING_STATUSES = ['DRAFT', 'ACTIVE', 'SOLD', 'ARCHIVED'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const VEHICLE_CONDITIONS = ['NEW', 'USED', 'CERTIFIED_PRE_OWNED'] as const;
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
] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const TRANSMISSIONS = ['AUTOMATIC', 'MANUAL', 'CVT', 'DUAL_CLUTCH'] as const;
export type Transmission = (typeof TRANSMISSIONS)[number];

export const FUEL_TYPES = [
  'GASOLINE',
  'DIESEL',
  'HYBRID',
  'PLUG_IN_HYBRID',
  'ELECTRIC',
] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const DRIVETRAINS = ['FWD', 'RWD', 'AWD', 'FOUR_WHEEL_DRIVE'] as const;
export type Drivetrain = (typeof DRIVETRAINS)[number];

/** Atlas launches in Canada, so location is modelled as province + city. */
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

export const LISTING_SORTS = [
  'RELEVANCE',
  'NEWEST',
  'PRICE_ASC',
  'PRICE_DESC',
  'MILEAGE_ASC',
  'YEAR_DESC',
] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];

/** Oldest model year a listing may claim; guards against typos like `19995`. */
export const MIN_MODEL_YEAR = 1900;

/** Listings may be posted up to one model year ahead of the current calendar year. */
export const maxModelYear = (now: Date = new Date()): number => now.getUTCFullYear() + 1;

export const MAX_LISTING_IMAGES = 20;

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
  FOUR_WHEEL_DRIVE: '4WD',
  DUAL_CLUTCH: 'Dual-clutch',
  PLUG_IN_HYBRID: 'Plug-in hybrid',
  CERTIFIED_PRE_OWNED: 'Certified pre-owned',
  PRIVATE_SELLER: 'Private seller',
};

/**
 * Human-readable label for an enum value, used by the web app's filter controls
 * and detail pages. Falls back to sentence case: SEDAN -> "Sedan".
 */
export const labelize = (value: string): string => {
  const override = LABEL_OVERRIDES[value];
  if (override) return override;

  const words = value.split('_');
  return words
    .map((word, index) =>
      index === 0
        ? word.charAt(0) + word.slice(1).toLowerCase()
        : word.toLowerCase(),
    )
    .join(' ');
};
