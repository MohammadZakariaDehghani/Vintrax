import { z } from 'zod';
import {
  ADDRESS_TYPES,
  AUCTION_STATUSES,
  BODY_TYPES,
  CONDITION_GRADES,
  CREATABLE_LISTING_STATUSES,
  DRIVETRAINS,
  FUEL_TYPES,
  INSPECTION_SECTIONS,
  LISTING_SORTS,
  MAX_INSPECTION_IMAGES,
  MAX_LISTING_IMAGES,
  MAX_VEHICLE_DOCUMENTS,
  MIN_MODEL_YEAR,
  NOTIFICATION_CHANNELS,
  PAYMENT_METHODS,
  PROVINCES,
  SALE_CHANNELS,
  SECTION_RATINGS,
  SELLER_SETTABLE_LISTING_STATUSES,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
  VEHICLE_DOCUMENT_TYPES,
  VIN_PATTERN,
  maxModelYear,
} from './domain';

/**
 * Query strings deliver a repeated key as an array or a single value, and the
 * frontend sends comma-separated lists. Normalise both into a deduplicated array.
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
const uuid = () => z.string().uuid();

/** Whole Canadian dollars. Integer to avoid floating-point drift on money. */
const money = (max = 10_000_000) => z.coerce.number().int().min(0).max(max);

// --- Auth --------------------------------------------------------------------

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    firstName: trimmed(60).min(1),
    lastName: trimmed(60).min(1),
    // ADMIN and SUPER_ADMIN are never self-assignable.
    role: z.enum(['BUYER', 'SELLER', 'DEALER']).default('BUYER'),
    phone: trimmed(30).optional(),
    province: z.enum(PROVINCES).optional(),
    city: trimmed(80).optional(),
    // Dealer registration details, required when role is DEALER.
    dealershipName: trimmed(140).min(2).optional(),
    businessNumber: trimmed(40).optional(),
    licenceNumber: trimmed(60).optional(),
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

export const refreshSchema = z.object({ refreshToken: z.string().min(1) });
export type RefreshInput = z.infer<typeof refreshSchema>;

export const requestPasswordResetSchema = z.object({ email: emailSchema });
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(1) });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateProfileSchema = z
  .object({
    firstName: trimmed(60).min(1).optional(),
    lastName: trimmed(60).min(1).optional(),
    phone: trimmed(30).optional(),
    province: z.enum(PROVINCES).optional(),
    city: trimmed(80).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// --- Addresses ---------------------------------------------------------------

export const addressSchema = z.object({
  type: z.enum(ADDRESS_TYPES),
  line1: trimmed(160).min(1),
  line2: trimmed(160).optional(),
  city: trimmed(80).min(1),
  province: z.enum(PROVINCES),
  postalCode: z
    .string()
    .trim()
    .toUpperCase()
    // Canadian postal code, with or without the conventional middle space.
    .regex(/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/, 'Enter a valid Canadian postal code'),
  country: trimmed(2).default('CA'),
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.infer<typeof addressSchema>;

// --- Vehicles ----------------------------------------------------------------

export const vehicleImageSchema = z.object({
  url: trimmed(500).min(1),
  alt: trimmed(160).optional(),
});

export const vehicleDocumentSchema = z.object({
  type: z.enum(VEHICLE_DOCUMENT_TYPES),
  url: trimmed(500).min(1),
  filename: trimmed(200).min(1),
  sizeBytes: z.coerce.number().int().min(0).optional(),
});

export const createVehicleSchema = z.object({
  title: trimmed(160).min(6),
  description: trimmed(8000).min(20),

  vin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(VIN_PATTERN, 'VIN must be 17 characters and exclude I, O and Q')
    .optional(),

  make: trimmed(60).min(1),
  model: trimmed(60).min(1),
  trim: trimmed(60).optional(),
  year: z.coerce.number().int().min(MIN_MODEL_YEAR).max(maxModelYear()),

  priceCad: money().refine((value) => value >= 1, { message: 'Price is required' }),
  /** Lowest price the seller will accept in an auction. Never shown to buyers. */
  reservePriceCad: money().optional(),
  mileageKm: z.coerce.number().int().min(0).max(2_000_000),

  condition: z.enum(VEHICLE_CONDITIONS),
  bodyType: z.enum(BODY_TYPES),
  transmission: z.enum(TRANSMISSIONS),
  fuelType: z.enum(FUEL_TYPES),
  drivetrain: z.enum(DRIVETRAINS),

  engine: trimmed(80).optional(),
  engineSizeL: z.coerce.number().min(0).max(20).optional(),
  cylinders: z.coerce.number().int().min(0).max(16).optional(),
  doors: z.coerce.number().int().min(0).max(8).optional(),
  seats: z.coerce.number().int().min(0).max(60).optional(),
  exteriorColour: trimmed(40).optional(),
  interiorColour: trimmed(40).optional(),

  province: z.enum(PROVINCES),
  city: trimmed(80).min(1),
  postalCode: trimmed(10).optional(),

  saleChannel: z.enum(SALE_CHANNELS).default('FIXED_PRICE'),
  // Not the full LISTING_STATUSES set: a listing cannot be created published.
  status: z.enum(CREATABLE_LISTING_STATUSES).default('DRAFT'),

  features: z.array(trimmed(60)).max(60).default([]),
  images: z.array(vehicleImageSchema).max(MAX_LISTING_IMAGES).default([]),
  documents: z.array(vehicleDocumentSchema).max(MAX_VEHICLE_DOCUMENTS).default([]),
});
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

/**
 * `status` is deliberately omitted, and the schema is strict so that sending it
 * anyway is an error rather than a no-op.
 *
 * The update handler spreads validated fields into the database write, so any
 * key this schema accepts is a key the caller can set. Leaving `status` in
 * would let a seller move their own listing to `ACTIVE` and skip moderation
 * entirely. Status changes go through `PATCH /vehicles/:id/status`, which
 * enforces the transition table, or through admin moderation.
 *
 * Strict, not merely stripping: an edit form that keeps sending `status` gets a
 * save that reports success and changes nothing, which is worse than a refusal
 * and is exactly how this went unnoticed once already.
 */
export const updateVehicleSchema = createVehicleSchema
  .omit({ status: true })
  .partial()
  .strict(
    'Unexpected field. Listing status is changed through PATCH /vehicles/:id/status, not here.',
  )
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

export const updateListingStatusSchema = z.object({
  status: z.enum(SELLER_SETTABLE_LISTING_STATUSES),
});
export type UpdateListingStatusInput = z.infer<typeof updateListingStatusSchema>;

// --- Search ------------------------------------------------------------------

export const MAX_PAGE_SIZE = 60;

export const searchVehiclesSchema = z
  .object({
    q: trimmed(160).optional(),
    make: trimmed(60).optional(),
    model: trimmed(60).optional(),
    minYear: z.coerce.number().int().min(MIN_MODEL_YEAR).optional(),
    maxYear: z.coerce.number().int().max(maxModelYear()).optional(),
    minPrice: money().optional(),
    maxPrice: money().optional(),
    maxMileageKm: z.coerce.number().int().min(0).optional(),
    bodyType: csvEnumArray(BODY_TYPES),
    fuelType: csvEnumArray(FUEL_TYPES),
    transmission: csvEnumArray(TRANSMISSIONS),
    drivetrain: csvEnumArray(DRIVETRAINS),
    condition: csvEnumArray(VEHICLE_CONDITIONS),
    saleChannel: csvEnumArray(SALE_CHANNELS),
    province: z.enum(PROVINCES).optional(),
    city: trimmed(80).optional(),
    sellerType: z.enum(['DEALER', 'SELLER']).optional(),
    /** Restrict to vehicles with a completed inspection report. */
    inspectedOnly: z.coerce.boolean().optional(),
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
export type SearchVehiclesQuery = z.infer<typeof searchVehiclesSchema>;

// --- Auctions ----------------------------------------------------------------

export const createAuctionSchema = z
  .object({
    vehicleId: uuid(),
    title: trimmed(160).min(6).optional(),
    startingBidCad: money(),
    reservePriceCad: money().optional(),
    /** Immediate-purchase price. Ends the auction when met. */
    buyNowPriceCad: money().optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((data) => data.endsAt > data.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  })
  .refine(
    (data) => !data.buyNowPriceCad || data.buyNowPriceCad > data.startingBidCad,
    { message: 'Buy-now price must exceed the starting bid', path: ['buyNowPriceCad'] },
  )
  .refine(
    (data) => !data.reservePriceCad || data.reservePriceCad >= data.startingBidCad,
    { message: 'Reserve cannot be below the starting bid', path: ['reservePriceCad'] },
  );
export type CreateAuctionInput = z.infer<typeof createAuctionSchema>;

export const updateAuctionSchema = z
  .object({
    title: trimmed(160).min(6).optional(),
    startingBidCad: money().optional(),
    reservePriceCad: money().optional(),
    buyNowPriceCad: money().optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    status: z.enum(AUCTION_STATUSES).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateAuctionInput = z.infer<typeof updateAuctionSchema>;

export const placeBidSchema = z.object({
  amountCad: money().refine((value) => value > 0, { message: 'Bid amount is required' }),
  /**
   * Optional ceiling for proxy bidding: the engine bids the minimum needed to
   * stay ahead, up to this amount, rather than committing the full value.
   */
  maxProxyAmountCad: money().optional(),
});
export type PlaceBidInput = z.infer<typeof placeBidSchema>;

export const searchAuctionsSchema = z.object({
  status: csvEnumArray(AUCTION_STATUSES),
  make: trimmed(60).optional(),
  province: z.enum(PROVINCES).optional(),
  /** Only auctions the caller has bid on. */
  participatingOnly: z.coerce.boolean().optional(),
  sort: z.enum(['ENDING_SOON', 'NEWEST', 'PRICE_ASC', 'PRICE_DESC']).default('ENDING_SOON'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(24),
});
export type SearchAuctionsQuery = z.infer<typeof searchAuctionsSchema>;

// --- Inspections -------------------------------------------------------------

export const inspectionSectionSchema = z.object({
  section: z.enum(INSPECTION_SECTIONS),
  rating: z.enum(SECTION_RATINGS),
  notes: trimmed(2000).optional(),
});

export const createInspectionSchema = z.object({
  vehicleId: uuid(),
  scheduledFor: z.coerce.date().optional(),
});
export type CreateInspectionInput = z.infer<typeof createInspectionSchema>;

export const submitInspectionSchema = z.object({
  overallGrade: z.enum(CONDITION_GRADES),
  summary: trimmed(4000).min(20),
  odometerReadingKm: z.coerce.number().int().min(0).max(2_000_000),
  /** Structural damage disclosure — the single most material buyer signal. */
  hasFrameDamage: z.boolean(),
  hasAccidentHistory: z.boolean(),
  estimatedReconditioningCad: money(100_000).optional(),
  sections: z.array(inspectionSectionSchema).min(1),
  images: z.array(vehicleImageSchema).max(MAX_INSPECTION_IMAGES).default([]),
});
export type SubmitInspectionInput = z.infer<typeof submitInspectionSchema>;

// --- Commerce ----------------------------------------------------------------

export const createOrderSchema = z.object({
  vehicleId: uuid(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  shippingAddressId: uuid().optional(),
  notes: trimmed(1000).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const confirmPaymentSchema = z.object({
  /** Reference returned by the payment provider. */
  providerReference: trimmed(200).min(1),
});
export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>;

// --- Messaging and notifications ---------------------------------------------

export const messageBodySchema = trimmed(4000).min(1, 'Message cannot be empty');

export const startConversationSchema = z.object({
  vehicleId: uuid(),
  body: messageBodySchema,
});
export type StartConversationInput = z.infer<typeof startConversationSchema>;

export const sendMessageSchema = z.object({ body: messageBodySchema });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const notificationPreferencesSchema = z.object({
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)).min(1),
});
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;

// --- Administration ----------------------------------------------------------

export const verifyDealerSchema = z.object({
  approved: z.boolean(),
  notes: trimmed(1000).optional(),
});
export type VerifyDealerInput = z.infer<typeof verifyDealerSchema>;

export const moderateListingSchema = z.object({
  approved: z.boolean(),
  reason: trimmed(1000).optional(),
});
export type ModerateListingInput = z.infer<typeof moderateListingSchema>;

export const updateUserStatusSchema = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
  reason: trimmed(1000).optional(),
});
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const auditLogQuerySchema = z.object({
  actorId: uuid().optional(),
  action: trimmed(80).optional(),
  entityType: trimmed(60).optional(),
  entityId: uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

// --- Pagination --------------------------------------------------------------

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;
