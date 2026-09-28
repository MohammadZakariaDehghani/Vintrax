import type { Prisma } from '@prisma/client';
import type { AuctionSummary, VehicleDetail, VehicleImage, VehicleSummary } from '@vintrax/shared';
import { buildOptimizedImage } from '@vintrax/shared';

/** What a processed photo needs to list its renditions; see `VehicleImageAsset`. */
export const imageAssetSelect = {
  baseUrl: true,
  widths: true,
  formats: true,
  width: true,
  height: true,
} as const;

/** One photo row, as every vehicle select reads it. */
export const vehicleImageSelect = {
  id: true,
  url: true,
  alt: true,
  position: true,
  asset: { select: imageAssetSelect },
} as const;

export function toVehicleImage(
  image: Prisma.VehicleImageGetPayload<{ select: typeof vehicleImageSelect }>,
): VehicleImage {
  return {
    id: image.id,
    url: image.url,
    alt: image.alt,
    position: image.position,
    optimized: optimizedFrom(image.asset),
  };
}

export function optimizedFrom(
  asset: Prisma.VehicleImageAssetGetPayload<{ select: typeof imageAssetSelect }> | null,
) {
  return asset ? buildOptimizedImage(asset) : null;
}

/** Fields needed to render a vehicle card in search results and inventory grids. */
export const vehicleSummarySelect = {
  id: true,
  slug: true,
  title: true,
  make: true,
  model: true,
  trim: true,
  year: true,
  priceCad: true,
  previousPriceCad: true,
  mileageKm: true,
  condition: true,
  bodyType: true,
  fuelType: true,
  transmission: true,
  drivetrain: true,
  province: true,
  city: true,
  status: true,
  saleChannel: true,
  // On the summary because the search cards draw the badge strip, and one
  // extra request per card to find out whether to draw it would be absurd.
  carfaxUrl: true,
  badgeLowKilometres: true,
  badgeOneOwner: true,
  badgeNoAccident: true,
  badgeCarfax: true,
  publishedAt: true,
  createdAt: true,
  images: {
    select: vehicleImageSelect,
    orderBy: { position: 'asc' },
    take: 1,
  },
  _count: { select: { images: true } },
  inspections: {
    where: { status: 'COMPLETED' },
    select: { overallGrade: true },
    orderBy: { completedAt: 'desc' },
    take: 1,
  },
  auctions: {
    where: { status: { in: ['SCHEDULED', 'LIVE'] } },
    select: {
      id: true,
      vehicleId: true,
      title: true,
      status: true,
      startingBidCad: true,
      currentBidCad: true,
      bidCount: true,
      buyNowPriceCad: true,
      reservePriceCad: true,
      startsAt: true,
      endsAt: true,
    },
    orderBy: { endsAt: 'asc' },
    take: 1,
  },
} satisfies Prisma.VehicleSelect;

export const vehicleSellerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  role: true,
  province: true,
  city: true,
  createdAt: true,
  dealer: {
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      verified: true,
      logoUrl: true,
      city: true,
      province: true,
    },
  },
} satisfies Prisma.UserSelect;

/** Summary fields plus everything only the detail page needs. */
export const vehicleDetailSelect = {
  ...vehicleSummarySelect,
  description: true,
  vin: true,
  stockNumber: true,
  titleStatus: true,
  engine: true,
  engineSizeL: true,
  cylinders: true,
  doors: true,
  seats: true,
  exteriorColour: true,
  interiorColour: true,
  postalCode: true,
  features: true,
  viewCount: true,
  favouriteCount: true,
  updatedAt: true,
  images: {
    select: vehicleImageSelect,
    orderBy: { position: 'asc' },
  },
  documents: {
    select: {
      id: true,
      type: true,
      url: true,
      filename: true,
      sizeBytes: true,
      issuedOn: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
  historyEvents: {
    select: {
      id: true,
      kind: true,
      occurredOn: true,
      label: true,
      detail: true,
      position: true,
    },
    orderBy: { position: 'asc' },
  },
  seller: { select: vehicleSellerSelect },
  inspections: {
    where: { status: 'COMPLETED' },
    select: {
      id: true,
      vehicleId: true,
      status: true,
      overallGrade: true,
      hasFrameDamage: true,
      hasAccidentHistory: true,
      completedAt: true,
    },
    orderBy: { completedAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.VehicleSelect;

export type VehicleSummaryRow = Prisma.VehicleGetPayload<{ select: typeof vehicleSummarySelect }>;
export type VehicleDetailRow = Prisma.VehicleGetPayload<{ select: typeof vehicleDetailSelect }>;

/** Seconds until an auction closes, floored at zero. */
export function secondsRemaining(endsAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((endsAt.getTime() - now.getTime()) / 1000));
}

function toEmbeddedAuction(row: VehicleSummaryRow['auctions'][number]): AuctionSummary {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    title: row.title,
    status: row.status,
    startingBidCad: row.startingBidCad,
    currentBidCad: row.currentBidCad,
    bidCount: row.bidCount,
    buyNowPriceCad: row.buyNowPriceCad,
    // The reserve amount itself is never exposed — only whether it is met.
    reserveMet: row.reservePriceCad === null || row.currentBidCad >= row.reservePriceCad,
    hasReserve: row.reservePriceCad !== null,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    secondsRemaining: secondsRemaining(row.endsAt),
    vehicle: null,
  };
}

export function toVehicleSummary(
  row: VehicleSummaryRow,
  favouritedIds: ReadonlySet<string>,
): VehicleSummary {
  const auction = row.auctions[0];
  const inspection = row.inspections[0];

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    make: row.make,
    model: row.model,
    trim: row.trim,
    year: row.year,
    priceCad: row.priceCad,
    previousPriceCad: row.previousPriceCad,
    mileageKm: row.mileageKm,
    condition: row.condition,
    bodyType: row.bodyType,
    fuelType: row.fuelType,
    transmission: row.transmission,
    drivetrain: row.drivetrain,
    province: row.province,
    city: row.city,
    status: row.status,
    saleChannel: row.saleChannel,
    primaryImageUrl: row.images[0]?.url ?? null,
    primaryImage: optimizedFrom(row.images[0]?.asset ?? null),
    imageCount: row._count.images,
    isFavourited: favouritedIds.has(row.id),
    hasInspection: Boolean(inspection),
    inspectionGrade: inspection?.overallGrade ?? null,
    carfaxUrl: row.carfaxUrl,
    badges: {
      lowKilometres: row.badgeLowKilometres,
      oneOwner: row.badgeOneOwner,
      noAccident: row.badgeNoAccident,
      carfax: row.badgeCarfax,
    },
    activeAuction: auction ? toEmbeddedAuction(auction) : null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Builds the detail response.
 *
 * `includeDocuments` defaults to false so a caller has to say, explicitly,
 * that this viewer is allowed to see them — the seller and an admin, in
 * practice. The documents themselves are addressed by an authorized API
 * route rather than by their location in storage, so the response never
 * discloses where the file actually lives.
 */
export function toVehicleDetail(
  row: VehicleDetailRow,
  favouritedIds: ReadonlySet<string>,
  options: { includeDocuments?: boolean } = {},
): VehicleDetail {
  const inspection = row.inspections[0];

  return {
    ...toVehicleSummary(row, favouritedIds),
    description: row.description,
    vin: row.vin,
    stockNumber: row.stockNumber,
    titleStatus: row.titleStatus,
    engine: row.engine,
    engineSizeL: row.engineSizeL,
    cylinders: row.cylinders,
    doors: row.doors,
    seats: row.seats,
    exteriorColour: row.exteriorColour,
    interiorColour: row.interiorColour,
    postalCode: row.postalCode,
    features: row.features,
    viewCount: row.viewCount,
    favouriteCount: row.favouriteCount,
    images: row.images.map(toVehicleImage),
    documents: options.includeDocuments
      ? row.documents.map((document) => ({
          id: document.id,
          type: document.type,
          url: `/vehicles/${row.id}/documents/${document.id}`,
          filename: document.filename,
          sizeBytes: document.sizeBytes,
          uploadedAt: document.createdAt.toISOString(),
          issuedOn: asDate(document.issuedOn),
        }))
      : [],
    documentCount: row.documents.length,
    // Every entry is the dealer's own account, so nothing here is filtered by
    // viewer the way a CARFAX-sourced row briefly was.
    historyEvents: row.historyEvents.map((event) => ({
      id: event.id,
      kind: event.kind,
      occurredOn: asDate(event.occurredOn),
      label: event.label,
      detail: event.detail,
    })),
    seller: {
      id: row.seller.id,
      displayName: `${row.seller.firstName} ${row.seller.lastName}`.trim(),
      role: row.seller.role,
      province: row.seller.province,
      city: row.seller.city,
      dealer: row.seller.dealer,
      memberSince: row.seller.createdAt.toISOString(),
    },
    inspection: inspection
      ? {
          id: inspection.id,
          vehicleId: inspection.vehicleId,
          status: inspection.status,
          overallGrade: inspection.overallGrade,
          hasFrameDamage: inspection.hasFrameDamage,
          hasAccidentHistory: inspection.hasAccidentHistory,
          completedAt: inspection.completedAt?.toISOString() ?? null,
        }
      : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A `@db.Date` column as `YYYY-MM-DD`, which is what it holds. */
function asDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}
