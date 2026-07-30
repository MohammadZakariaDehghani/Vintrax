import type {
  BodyType,
  Drivetrain,
  FuelType,
  ListingStatus,
  Province,
  Transmission,
  UserRole,
  VehicleCondition,
} from './domain';

/** Shape returned by every paginated collection endpoint. */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  phone: string | null;
  province: Province | null;
  city: string | null;
  dealership: DealershipSummary | null;
  createdAt: string;
}

export interface DealershipSummary {
  id: string;
  name: string;
  verified: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends AuthTokens {
  user: PublicUser;
}

/** The seller as shown on a listing — never exposes the seller's email. */
export interface ListingSeller {
  id: string;
  displayName: string;
  role: UserRole;
  province: Province | null;
  city: string | null;
  dealership: DealershipSummary | null;
  memberSince: string;
}

export interface ListingImage {
  id: string;
  url: string;
  alt: string | null;
  position: number;
}

/** Trimmed listing shape used in search results and dashboard grids. */
export interface ListingSummary {
  id: string;
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
  primaryImageUrl: string | null;
  imageCount: number;
  isFavourited: boolean;
  publishedAt: string | null;
  createdAt: string;
}

export interface ListingDetail extends ListingSummary {
  description: string;
  exteriorColour: string | null;
  vin: string | null;
  viewCount: number;
  images: ListingImage[];
  seller: ListingSeller;
  updatedAt: string;
}

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
  listing: Pick<ListingSummary, 'id' | 'title' | 'priceCad' | 'primaryImageUrl' | 'status'>;
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

/** Facet counts returned alongside search results to drive filter UI. */
export interface SearchFacets {
  makes: Array<{ value: string; count: number }>;
  bodyTypes: Array<{ value: BodyType; count: number }>;
  provinces: Array<{ value: Province; count: number }>;
}

export interface ListingSearchResponse extends Paginated<ListingSummary> {
  facets: SearchFacets;
}

/** Uniform error body produced by the API's exception filter. */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  /** Field-level validation failures, keyed by dotted path. */
  details?: Record<string, string[]>;
  timestamp: string;
  path: string;
}
