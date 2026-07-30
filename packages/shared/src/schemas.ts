import { z } from 'zod';
import {
  BODY_TYPES,
  DRIVETRAINS,
  FUEL_TYPES,
  LISTING_SORTS,
  LISTING_STATUSES,
  MAX_LISTING_IMAGES,
  MIN_MODEL_YEAR,
  PROVINCES,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
  maxModelYear,
} from './domain';

/**
 * Query strings can deliver a repeated key as an array or a single value, and the
 * web app sends comma-separated lists. Normalise both into a deduplicated array.
 */
const csvEnumArray = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((input) => {
      if (input === undefined) return undefined;
      const parts = (Array.isArray(input) ? input : input.split(','))
        .map((part) => part.trim().toUpperCase())
        .filter(Boolean);
      return parts.length ? Array.from(new Set(parts)) : undefined;
    })
    .pipe(z.array(z.enum(values)).nonempty().optional());

const trimmed = (max: number) => z.string().trim().max(max);

// --- Auth -------------------------------------------------------------------

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: trimmed(80).min(2),
    // Accounts self-select a seller role at signup; ADMIN is never self-assignable.
    role: z.enum(['BUYER', 'PRIVATE_SELLER', 'DEALER']).default('BUYER'),
    dealershipName: trimmed(120).min(2).optional(),
    phone: trimmed(30).optional(),
    province: z.enum(PROVINCES).optional(),
    city: trimmed(80).optional(),
  })
  .refine((data) => data.role !== 'DEALER' || !!data.dealershipName, {
    message: 'Dealership name is required for dealer accounts',
    path: ['dealershipName'],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

// --- Listings ---------------------------------------------------------------

export const listingImageSchema = z.object({
  url: z.string().trim().min(1).max(500),
  alt: trimmed(160).optional(),
});

export const createListingSchema = z.object({
  title: trimmed(140).min(6),
  description: trimmed(6000).min(20),
  make: trimmed(60).min(1),
  model: trimmed(60).min(1),
  trim: trimmed(60).optional(),
  year: z.coerce
    .number()
    .int()
    .min(MIN_MODEL_YEAR)
    .max(maxModelYear())
    .describe('Model year'),
  // Price in whole Canadian dollars. Stored as an integer to avoid float drift.
  priceCad: z.coerce.number().int().min(1).max(10_000_000),
  mileageKm: z.coerce.number().int().min(0).max(2_000_000),
  condition: z.enum(VEHICLE_CONDITIONS),
  bodyType: z.enum(BODY_TYPES),
  transmission: z.enum(TRANSMISSIONS),
  fuelType: z.enum(FUEL_TYPES),
  drivetrain: z.enum(DRIVETRAINS),
  exteriorColour: trimmed(40).optional(),
  vin: z
    .string()
    .trim()
    .toUpperCase()
    // Standard 17-character VIN; I, O and Q are excluded by the standard.
    .regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'VIN must be 17 characters and exclude I, O and Q')
    .optional(),
  province: z.enum(PROVINCES),
  city: trimmed(80).min(1),
  status: z.enum(LISTING_STATUSES).default('DRAFT'),
  images: z.array(listingImageSchema).max(MAX_LISTING_IMAGES).default([]),
});
export type CreateListingInput = z.infer<typeof createListingSchema>;

/** Every field optional, but the payload must change something. */
export const updateListingSchema = createListingSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateListingInput = z.infer<typeof updateListingSchema>;

// --- Search -----------------------------------------------------------------

export const MAX_PAGE_SIZE = 60;

export const searchListingsSchema = z
  .object({
    q: trimmed(120).optional(),
    make: trimmed(60).optional(),
    model: trimmed(60).optional(),
    minYear: z.coerce.number().int().min(MIN_MODEL_YEAR).optional(),
    maxYear: z.coerce.number().int().max(maxModelYear()).optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    maxMileageKm: z.coerce.number().int().min(0).optional(),
    bodyType: csvEnumArray(BODY_TYPES),
    fuelType: csvEnumArray(FUEL_TYPES),
    transmission: csvEnumArray(TRANSMISSIONS),
    drivetrain: csvEnumArray(DRIVETRAINS),
    condition: csvEnumArray(VEHICLE_CONDITIONS),
    province: z.enum(PROVINCES).optional(),
    city: trimmed(80).optional(),
    sellerType: z.enum(['DEALER', 'PRIVATE_SELLER']).optional(),
    sort: z.enum(LISTING_SORTS).default('RELEVANCE'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(24),
  })
  .refine((data) => !data.minPrice || !data.maxPrice || data.minPrice <= data.maxPrice, {
    message: 'minPrice must be less than or equal to maxPrice',
    path: ['minPrice'],
  })
  .refine((data) => !data.minYear || !data.maxYear || data.minYear <= data.maxYear, {
    message: 'minYear must be less than or equal to maxYear',
    path: ['minYear'],
  });
export type SearchListingsQuery = z.infer<typeof searchListingsSchema>;

// --- Messaging --------------------------------------------------------------

export const messageBodySchema = trimmed(4000).min(1, 'Message cannot be empty');

/** Buyers open a thread from a listing; the seller is derived server-side. */
export const startConversationSchema = z.object({
  listingId: z.string().uuid(),
  body: messageBodySchema,
});
export type StartConversationInput = z.infer<typeof startConversationSchema>;

export const sendMessageSchema = z.object({
  body: messageBodySchema,
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

// --- Pagination -------------------------------------------------------------

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;
