import type {
  AddressType,
  ArticleStatus,
  AuctionStatus,
  BidStatus,
  BodyType,
  ConditionGrade,
  DealerStatus,
  Drivetrain,
  FooterLinkIcon,
  FuelType,
  InspectionSection,
  InspectionStatus,
  ListingStatus,
  NotificationChannel,
  NotificationType,
  Permission,
  Province,
  SaleChannel,
  SectionRating,
  Transmission,
  UserRole,
  UserStatus,
  VehicleCondition,
  VehicleDocumentType,
  VehicleHistoryEventKind,
  VehicleHistorySource,
  TitleStatus,
} from './domain';

/** Shape returned by every paginated collection endpoint. */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// --- Identity ----------------------------------------------------------------

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  phone: string | null;
  province: Province | null;
  city: string | null;
  avatarUrl: string | null;
  dealer: DealerSummary | null;
  permissions: Permission[];
  createdAt: string;
}

export interface DealerSummary {
  id: string;
  name: string;
  slug: string;
  status: DealerStatus;
  verified: boolean;
  logoUrl: string | null;
  city: string | null;
  province: Province | null;
}

export interface DealerDetail extends DealerSummary {
  businessNumber: string | null;
  licenceNumber: string | null;
  description: string | null;
  websiteUrl: string | null;
  phone: string | null;
  activeListingCount: number;
  completedSaleCount: number;
  memberSince: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse extends AuthTokens {
  user: PublicUser;
}

export interface Address {
  id: string;
  type: AddressType;
  line1: string;
  line2: string | null;
  city: string;
  province: Province;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

// --- Vehicles ----------------------------------------------------------------

/** The seller as shown on a listing. Never exposes a private email address. */
export interface VehicleSeller {
  id: string;
  displayName: string;
  role: UserRole;
  province: Province | null;
  city: string | null;
  dealer: DealerSummary | null;
  memberSince: string;
}

export interface VehicleImage {
  id: string;
  url: string;
  alt: string | null;
  position: number;
}

export interface VehicleDocument {
  id: string;
  type: VehicleDocumentType;
  /**
   * Authorized download path, not the object's location in storage. Requires
   * the caller's access token, so it is fetched rather than linked.
   */
  url: string;
  filename: string;
  sizeBytes: number | null;
  uploadedAt: string;
  /** The date printed on the document, `YYYY-MM-DD`, where the seller gave one. */
  issuedOn: string | null;
}

/**
 * One entry on a vehicle's history timeline.
 *
 * Seller-asserted, transcribed from the report they hold — Vintrax has no
 * CARFAX integration and retrieves nothing. The uploaded report is the
 * evidence; this is the summary a buyer reads without asking for the PDF, and
 * the interface labels it as the dealer's own account rather than as verified.
 */
export interface VehicleHistoryEvent {
  id: string;
  kind: VehicleHistoryEventKind;
  /** `YYYY-MM-DD`, or null for an entry with no date on the report. */
  occurredOn: string | null;
  label: string;
  detail: string | null;
  /**
   * Whether this line was typed by the seller or read off an old CARFAX
   * fetch from before that feature was removed. New entries are always
   * `SELLER` — nothing writes `CARFAX` rows anymore.
   */
  source: VehicleHistorySource;
}

/** Trimmed vehicle shape used in search results and inventory grids. */
export interface VehicleSummary {
  id: string;
  slug: string;
  title: string;
  make: string;
  model: string;
  trim: string | null;
  year: number;
  priceCad: number;
  mileageKm: number;
  condition: VehicleCondition;
  bodyType: BodyType;
  fuelType: FuelType;
  transmission: Transmission;
  drivetrain: Drivetrain;
  province: Province;
  city: string;
  status: ListingStatus;
  saleChannel: SaleChannel;
  primaryImageUrl: string | null;
  imageCount: number;
  isFavourited: boolean;
  hasInspection: boolean;
  inspectionGrade: ConditionGrade | null;
  /**
   * The seller's link to the vehicle's CARFAX report, where they gave one.
   *
   * On the summary as well as the detail because the search results carry the
   * badge, and a second request per card to find out whether to draw it would
   * be absurd.
   */
  carfaxUrl: string | null;
  /**
   * What the seller's report says beyond the link itself, drawn as the joined
   * badge segments beside the CARFAX mark.
   *
   * Tri-state on purpose. `null` is "the seller did not answer", which is not
   * the same as `false`, "the report says otherwise" — every listing that
   * predates these fields is the former, and showing them as the latter would
   * have Vintrax assert something about cars nobody looked at. Neither draws a
   * segment; the difference matters in the seller's own form, where `null`
   * leaves the question open and `false` records an answer.
   */
  carfaxOneOwner: boolean | null;
  carfaxLowKilometres: boolean | null;
  /** Present when the vehicle is currently in an auction. */
  activeAuction: AuctionSummary | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface VehicleDetail extends VehicleSummary {
  description: string;
  /**
   * The full VIN, shown in the specifications.
   *
   * Previously masked to its last six characters. Issue #34 reversed that at
   * the owner's instruction: a buyer running their own history check needs the
   * whole number, and every other Canadian marketplace prints it.
   */
  vin: string | null;
  /** The seller's own stock number, for quoting on the phone or in email. */
  stockNumber: string | null;
  /** The brand on the title. Null where the seller has not stated one. */
  titleStatus: TitleStatus | null;
  engine: string | null;
  engineSizeL: number | null;
  cylinders: number | null;
  doors: number | null;
  seats: number | null;
  exteriorColour: string | null;
  interiorColour: string | null;
  postalCode: string | null;
  features: string[];
  viewCount: number;
  favouriteCount: number;
  images: VehicleImage[];
  /**
   * Paperwork — registration, title, CarFax, bill of sale. Empty unless the
   * viewer is the seller or an administrator: these documents carry the
   * owner's name, address and VIN history.
   */
  documents: VehicleDocument[];
  /** How many documents exist, regardless of whether the viewer may open them. */
  documentCount: number;
  /**
   * The vehicle's history timeline, oldest first. Public: unlike the documents
   * it summarises, it names no owner and carries no address.
   */
  historyEvents: VehicleHistoryEvent[];
  seller: VehicleSeller;
  inspection: InspectionSummary | null;
  updatedAt: string;
}

/** Facet counts returned alongside search results, to drive filter UI. */
export interface SearchFacets {
  makes: Array<{ value: string; count: number }>;
  bodyTypes: Array<{ value: BodyType; count: number }>;
  fuelTypes: Array<{ value: FuelType; count: number }>;
  provinces: Array<{ value: Province; count: number }>;
  priceRange: { min: number; max: number } | null;
}

export interface VehicleSearchResponse extends Paginated<VehicleSummary> {
  facets: SearchFacets;
  /** Which search backend answered, so clients can surface degraded modes. */
  provider: 'postgres' | 'opensearch';
  tookMs: number;
}

// --- Auctions ----------------------------------------------------------------

export interface AuctionSummary {
  id: string;
  vehicleId: string;
  title: string;
  status: AuctionStatus;
  startingBidCad: number;
  currentBidCad: number;
  bidCount: number;
  buyNowPriceCad: number | null;
  /** Whether the reserve has been met. The reserve itself is never exposed. */
  reserveMet: boolean;
  hasReserve: boolean;
  startsAt: string;
  endsAt: string;
  /** Server-computed, so clients never rely on their own clock. */
  secondsRemaining: number;
  vehicle: VehicleSummary | null;
}

export interface AuctionDetail extends AuctionSummary {
  minimumNextBidCad: number;
  /** The caller's standing in this auction, when authenticated. */
  viewerBid: {
    highestAmountCad: number;
    maxProxyAmountCad: number | null;
    status: BidStatus;
    isWinning: boolean;
  } | null;
  recentBids: BidSummary[];
  createdAt: string;
}

export interface BidSummary {
  id: string;
  auctionId: string;
  /** Anonymised handle, e.g. "Bidder 4" — real identities are never exposed. */
  bidderHandle: string;
  amountCad: number;
  status: BidStatus;
  placedAt: string;
  /** True when this bid belongs to the authenticated caller. */
  isOwn: boolean;
}

/** Payload broadcast over WebSocket when an auction changes. */
export interface AuctionEvent {
  type: 'BID_PLACED' | 'AUCTION_EXTENDED' | 'AUCTION_ENDED' | 'AUCTION_STARTED';
  auctionId: string;
  currentBidCad: number;
  bidCount: number;
  secondsRemaining: number;
  endsAt: string;
  reserveMet: boolean;
  latestBid: BidSummary | null;
  occurredAt: string;
}

// --- Inspections -------------------------------------------------------------

export interface InspectionSectionResult {
  section: InspectionSection;
  rating: SectionRating;
  notes: string | null;
}

export interface InspectionSummary {
  id: string;
  vehicleId: string;
  status: InspectionStatus;
  overallGrade: ConditionGrade | null;
  hasFrameDamage: boolean | null;
  hasAccidentHistory: boolean | null;
  completedAt: string | null;
}

export interface InspectionDetail extends InspectionSummary {
  inspectorName: string;
  summary: string | null;
  odometerReadingKm: number | null;
  estimatedReconditioningCad: number | null;
  sections: InspectionSectionResult[];
  images: VehicleImage[];
  scheduledFor: string | null;
  createdAt: string;
}

// --- Messaging and notifications ---------------------------------------------

export interface ConversationParticipant {
  id: string;
  displayName: string;
  role: UserRole;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  vehicle: Pick<VehicleSummary, 'id' | 'title' | 'priceCad' | 'primaryImageUrl' | 'status'>;
  buyer: ConversationParticipant;
  seller: ConversationParticipant;
  /** The other party relative to the authenticated caller. */
  counterparty: ConversationParticipant;
  lastMessage: MessageDto | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: MessageDto[];
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Deep link into the app, e.g. /auctions/<id>. */
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreferences {
  channels: NotificationChannel[];
}

// --- Analytics ---------------------------------------------------------------

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

export interface DealerAnalytics {
  activeListings: number;
  draftListings: number;
  soldThisMonth: number;
  grossSalesCadThisMonth: number;
  totalViews: number;
  totalEnquiries: number;
  averageDaysToSell: number | null;
  viewsSeries: TimeSeriesPoint[];
  salesSeries: TimeSeriesPoint[];
  topVehicles: Array<{ vehicle: VehicleSummary; views: number; enquiries: number }>;
}

/**
 * The photograph shown for one body-type shortcut on the home page.
 *
 * `imageUrl` null means no administrator has set one; the client falls back to
 * a photo from live inventory and then to a drawn silhouette, so a shortcut is
 * never missing. Returned for every body type, set or not, so an admin screen
 * can list them without knowing the enum.
 */
export interface BodyTypeImage {
  bodyType: BodyType;
  imageUrl: string | null;
  alt: string | null;
  updatedAt: string | null;
}

/**
 * A vehicle make's logo, set by an administrator to override the generated
 * mark the home page's "popular makes" row otherwise draws for that make.
 *
 * Unlike `BodyTypeImage`, only makes an administrator has actually set a logo
 * for appear here — there is no fixed enum of makes to backfill every entry
 * for, so `imageUrl` is never null on a row this type describes; a make with
 * no row simply keeps its generated mark.
 */
export interface MakeLogo {
  /** As the administrator typed it; matched against a vehicle's `make` case-insensitively. */
  make: string;
  imageUrl: string;
  alt: string | null;
  updatedAt: string;
}

/**
 * An editorial post.
 *
 * `body` is plain text: blank lines separate paragraphs and nothing is
 * interpreted as markup, so an author cannot put a script or an iframe on the
 * home page. That is a deliberate ceiling on the format — rich text on the
 * most-visited page of the site is a cross-site-scripting surface that would
 * need sanitising, and paragraphs are enough for what this is for.
 */
export interface Article {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  body: string;
  heroImageUrl: string;
  heroAlt: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  status: ArticleStatus;
  publishedAt: string | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the masthead and the index need, without the full body. */
export type ArticleSummary = Omit<Article, 'body'>;

/** One link under a footer section. */
export interface FooterLink {
  id: string;
  label: string;
  /** A site path, an `https://` address, a `mailto:` or a `tel:`. */
  href: string;
  icon: FooterLinkIcon | null;
  position: number;
}

/**
 * One column of the site footer.
 *
 * The whole footer is a short, ordered list of these — "About us",
 * "Resources", "Partners" and "Stay in touch" by default — each replaced as a
 * whole through `PUT /admin/footer`, the way a vehicle's history timeline is:
 * the client holds the ordered list, order is part of the data, and a section
 * with no links left is simply an empty column rather than a row to delete
 * separately.
 */
export interface FooterSection {
  id: string;
  title: string;
  position: number;
  links: FooterLink[];
}

export interface AdminAnalytics {
  totalUsers: number;
  newUsersThisMonth: number;
  pendingDealers: number;
  activeListings: number;
  listingsPendingReview: number;
  liveAuctions: number;
  vehiclesSoldThisMonth: number;
  usersSeries: TimeSeriesPoint[];
  listingsSeries: TimeSeriesPoint[];
}

// --- Audit -------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// --- Errors ------------------------------------------------------------------

/** Uniform error body produced by the API's exception filter. */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  /** Field-level validation failures, keyed by dotted path. */
  details?: Record<string, string[]>;
  /** Correlates a client-visible error with server logs. */
  requestId?: string;
  timestamp: string;
  path: string;
}
