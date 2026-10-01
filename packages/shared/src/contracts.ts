import type {
  AddressType,
  ArticleKind,
  ArticleStatus,
  AuctionStatus,
  BidStatus,
  BodyType,
  ConditionGrade,
  DealerStatus,
  Drivetrain,
  FooterLinkIcon,
  HomeFeatureButtonPlacement,
  HomeFeatureLayout,
  HomeHeroAlign,
  HomeHeroHeight,
  PromoTileMediaType,
  PromoTileWidth,
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
  VehicleBadges,
  VehicleCondition,
  VehicleDocumentType,
  VehicleHistoryEventKind,
  TitleStatus,
} from './domain';
import type { MediaPresentation } from './media';
import type { VehicleAvailability } from './vehicle-listing';

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

/**
 * How to phone a listing's seller, shown on the vehicle page to a signed-in
 * visitor who asks for it. The dealership's number when the seller is one,
 * otherwise the seller's own; null when neither is on file.
 */
export interface SellerContact {
  name: string;
  phone: string | null;
}

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

/** One encoded rendition of a processed photo. */
export interface ImageSource {
  width: number;
  url: string;
}

/**
 * A processed photo's responsive renditions (issue #74), for `srcset` and
 * `<picture>`. `width` × `height` is the largest rendition's size — the
 * photo's display aspect ratio, for reserving its space before it loads.
 * `avif` is empty unless IMAGE_AVIF_ENABLED is on.
 */
export interface OptimizedImage {
  width: number;
  height: number;
  webp: ImageSource[];
  avif: ImageSource[];
}

export interface VehicleImage {
  id: string;
  /**
   * A single displayable URL. For a processed photo this is already an
   * optimized WebP rendition, never the original upload.
   */
  url: string;
  alt: string | null;
  position: number;
  /** Null for a photo the image pipeline has not processed (see `images:migrate`). */
  optimized: OptimizedImage | null;
}

/** What `POST /uploads/images` returns: a processed photo, not yet on a listing. */
export interface UploadedVehicleImage {
  id: string;
  /** Pass this in a vehicle's `images[].url` to attach the photo. */
  url: string;
  key: string;
  sizeBytes: number;
  contentType: string;
  originalWidth: number;
  originalHeight: number;
  optimized: OptimizedImage;
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
 * One entry on a vehicle's history timeline, transcribed by the seller from
 * the report they hold — the uploaded document is the evidence, and the
 * interface labels this as the seller's own account rather than as verified.
 */
export interface VehicleHistoryEvent {
  id: string;
  kind: VehicleHistoryEventKind;
  /** `YYYY-MM-DD`, or null for an entry with no date on the report. */
  occurredOn: string | null;
  label: string;
  detail: string | null;
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
  /** The price before the most recent change, shown struck through; null if it never changed. */
  previousPriceCad: number | null;
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
  /** The primary photo's renditions, where it has been processed. */
  primaryImage: OptimizedImage | null;
  imageCount: number;
  isFavourited: boolean;
  hasInspection: boolean;
  inspectionGrade: ConditionGrade | null;
  /**
   * The seller's link to the vehicle's CARFAX report, where they gave one.
   * An associated reference only — nothing reads it. On the summary as well
   * as the detail because the search results carry the badge strip, and a
   * second request per card to find out whether to draw it would be absurd.
   */
  carfaxUrl: string | null;
  /**
   * The five badges the dealer set directly, one source of truth every
   * badge-drawing surface in the app reads from (issue #67).
   */
  badges: VehicleBadges;
  /** Present when the vehicle is currently in an auction. */
  activeAuction: AuctionSummary | null;
  publishedAt: string | null;
  createdAt: string;
}

/** Prices a dealer keeps with a vehicle for their own reference. */
export interface VehicleReferencePrices {
  salePriceCad: number | null;
  msrpCad: number | null;
  invoicePriceCad: number | null;
  retailPriceCad: number | null;
  wholesalePriceCad: number | null;
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
  horsepower: number | null;
  manufacturerColour: string | null;
  curbWeightLbs: number | null;
  /** Null: the seller has not said. */
  isDamaged: boolean | null;
  ownerCount: number | null;
  availability: VehicleAvailability | null;
  extendedWarranty: boolean | null;
  videoUrl: string | null;
  /**
   * The dealer's reference prices. Null for everyone but the seller and
   * administrators; buyers only ever see `priceCad`.
   */
  referencePrices: VehicleReferencePrices | null;
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
   * The vehicle's history timeline, oldest first, entered by the seller.
   * Public: unlike the documents it summarises, it names no owner and
   * carries no address.
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
 * A logo in the homepage's "Our Partners" carousel (issue #67).
 *
 * Unlike `MakeLogo`, a partner is not decorating something else that exists
 * independently — the row is the whole record — so it carries its own id
 * rather than being keyed on a name. `enabled` is what lets an admin take a
 * partner off the homepage without losing the record: `GET /admin/partners`
 * returns every partner, enabled or not, and it is the caller's job to
 * filter — the admin page needs to see both to manage them, and the
 * homepage filters to `enabled` itself.
 */
export interface Partner {
  id: string;
  name: string;
  logoUrl: string;
  alt: string | null;
  enabled: boolean;
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
  kind: ArticleKind;
  title: string;
  subtitle: string | null;
  body: string;
  /** Always set on a post; a page may have no photograph. */
  heroImageUrl: string | null;
  heroAlt: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  /**
   * The picture or video the post shows, with how it is cropped and animated.
   * Null for a post written before the media library: `heroImageUrl` is then
   * its picture (see `articleMedia`). When set, `heroImageUrl` is still filled
   * — with the photo or the video's poster — for cards, previews and sharing.
   */
  media: MediaPresentation | null;
  /** Pinned posts lead the blog and the home page in this order; null is by date. */
  homeOrder: number | null;
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
  /** An uploaded image drawn instead of the built-in icon. */
  imageUrl: string | null;
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
  /** Which of the footer's four columns it sits in, 1–4. Sections sharing one stack. */
  column: number;
  links: FooterLink[];
}

/**
 * Site-wide settings an administrator edits: the footer's copyright lines and
 * everything the Contact page shows. Public except `contactRecipient`, which
 * only the admin read carries.
 */
export interface SiteSettings {
  /** Shown after "© Copyright <year>". */
  footerCopyright: string;
  footerNote: string | null;
  contactIntro: string | null;
  contactAddress: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  contactHours: string | null;
  contactMapImageUrl: string | null;
  /** A Google Maps link to the place; the page frames `googleMapsEmbedUrl` of it. */
  contactMapUrl: string | null;
  updatedAt: string | null;
}

export interface AdminSiteSettings extends SiteSettings {
  /** Where Contact-form messages are emailed; falls back to `contactEmail`. */
  contactRecipient: string | null;
}

/**
 * A feature block on the home page, under "Recently listed". Stacked one under
 * another in `position` order; separate from the blog.
 */
export interface HomeFeature {
  id: string;
  title: string;
  /** A line above the text, under the title. */
  subtitle: string | null;
  body: string | null;
  /** The photo a block was saved with before the media library; `media` wins when set. */
  imageUrl: string | null;
  imageAlt: string | null;
  /** The picture or video, with crop and animation; see `homeFeatureMedia`. */
  media: MediaPresentation | null;
  /** Beside the text, or a full-width cinematic band with the text over it. */
  layout: HomeFeatureLayout;
  buttonLabel: string | null;
  /** A site path or an `https://` address. */
  buttonUrl: string | null;
  buttonPlacement: HomeFeatureButtonPlacement;
  position: number;
  enabled: boolean;
  updatedAt: string;
}

/**
 * One of the home page's boxes ("promo tiles"): a photograph or a video that
 * links to a page on Vintrax or another website, with optional words over it.
 * The admin always sees at least `PROMO_TILE_SLOTS` of them and can add more,
 * up to `PROMO_TILE_MAX_SLOTS`; `slot` is the box's place in the row, from 1.
 * A box without media is not shown.
 */
export interface PromoTile {
  slot: number;
  /** Words drawn over the media as real text, never baked into the picture. */
  title: string | null;
  body: string | null;
  /** A button label over the media; the whole box links to `linkUrl` either way. */
  ctaLabel: string | null;
  /** The picture or video with crop and animation; legacy fields below when null. */
  media: MediaPresentation | null;
  imageUrl: string | null;
  imageAlt: string | null;
  /** A site path or an `https://` address. */
  linkUrl: string | null;
  /** Twelfths of the row: one of `PROMO_TILE_WIDTHS`. */
  widthSpan: PromoTileWidth;
  /** Height on a full-width desktop page; it scales with the window. */
  heightPx: number;
  enabled: boolean;
  /** What fills the tile. The size and placement above are the same for either. */
  mediaType: PromoTileMediaType;
  /** The optimised, silent MP4 when the tile is a video. Kept when switching back to Image. */
  videoUrl: string | null;
  /** A frame of that video, shown before it plays and whenever it cannot. */
  videoPosterUrl: string | null;
  /** Null for a slot that has never been saved. */
  updatedAt: string | null;
}

/** Whether a tile has what its media type needs to be drawn. */
export function promoTileHasMedia(
  tile: Pick<PromoTile, 'mediaType' | 'imageUrl' | 'videoUrl'> & {
    media?: MediaPresentation | null;
  },
): boolean {
  if (tile.media) return true;
  return tile.mediaType === 'VIDEO' ? Boolean(tile.videoUrl) : Boolean(tile.imageUrl);
}

/**
 * The home page hero: a full-width picture or silent looping video with a
 * headline and buttons over it. While it is switched on it takes the top of
 * the home page; while it is off (the default) the newest blog posts do, as
 * before.
 */
export interface HomeHero {
  title: string;
  subtitle: string | null;
  primaryCtaLabel: string | null;
  /** A site path or an `https://` address. */
  primaryCtaUrl: string | null;
  secondaryCtaLabel: string | null;
  secondaryCtaUrl: string | null;
  /** How dark the shade over the media is, in percent, so the words stay readable. */
  overlayOpacity: number;
  align: HomeHeroAlign;
  height: HomeHeroHeight;
  media: MediaPresentation | null;
  /** Off is a draft: saved, previewable in the admin, not on the site. */
  enabled: boolean;
  updatedAt: string | null;
}

/** What a media library video upload produces, once optimised. */
export interface MediaVideoUploadStatus extends Omit<PromoVideoUploadStatus, 'result'> {
  /** Set when READY: the new library asset's id. */
  assetId: string | null;
}

/** A video upload in progress: sent in pieces, then optimised in the background. */
export interface PromoVideoUploadSession {
  uploadId: string;
  chunkBytes: number;
  chunkCount: number;
}

export const PROMO_VIDEO_UPLOAD_STATUSES = ['UPLOADING', 'PROCESSING', 'READY', 'FAILED'] as const;
export type PromoVideoUploadStatusValue = (typeof PROMO_VIDEO_UPLOAD_STATUSES)[number];

export interface PromoVideoUploadStatus {
  uploadId: string;
  status: PromoVideoUploadStatusValue;
  receivedBytes: number;
  sizeBytes: number;
  /** Set when READY. */
  result: PromoTileVideoUpload | null;
  /** Set when FAILED: why, in words an administrator can act on. */
  error: string | null;
}

/** What `POST /uploads/promo-tiles/video` returns. */
export interface PromoTileVideoUpload {
  videoUrl: string;
  posterUrl: string;
  width: number;
  height: number;
  durationSeconds: number;
  sizeBytes: number;
}

/** A make or model a visitor can pick in the car value tool, with how many listings back it. */
export interface CarValueOption {
  value: string;
  count: number;
}

/**
 * "Check your car's value": what comparable cars on Vintrax are listed or
 * sold for, adjusted to the visitor's year and kilometres.
 */
export interface VehicleValueEstimate {
  query: {
    year: number;
    make: string;
    model: string;
    trim: string | null;
    mileageKm: number;
    province: Province | null;
  };
  /** Null when too few comparable cars were found to say anything useful. */
  estimate: {
    /** The typical price a dealer would list this car at. */
    marketValue: number;
    /** The middle half of the adjusted comparable prices. */
    low: number;
    high: number;
    /** What a dealer would typically offer for it as a trade-in. */
    tradeInLow: number;
    tradeInHigh: number;
    /** How much weight the figure deserves, from how many cars and how close they were. */
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  } | null;
  comparableCount: number;
  /** The model years the comparables were drawn from. */
  yearsCompared: { from: number; to: number };
  averageMileageKm: number | null;
  /** A few of the comparable cars currently for sale, closest first. */
  comparables: VehicleSummary[];
}

/** Every car for sale on Vintrax like the visitor's, closest match first. */
export interface SimilarCars extends Paginated<VehicleSummary> {
  /** The model years searched, either side of the visitor's. */
  yearsCompared: { from: number; to: number };
}

/** A message sent through the Contact page, as an administrator reads it. */
export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
  createdAt: string;
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
