import type { Prisma } from '@prisma/client';
import type { AuctionSummary, VehicleDetail, VehicleSummary } from '@vintrax/shared';

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
  // On the summary because the search cards draw the CARFAX badge, and one
  // extra request per card to find out whether to draw it would be absurd.
  // The two highlights ride with it: they are segments of that same badge, so
  // fetching the link without them would draw half of it.
  carfaxUrl: true,
  carfaxOneOwner: true,
  carfaxLowKilometres: true,
  publishedAt: true,
  createdAt: true,
  images: {
    select: { id: true, url: true, alt: true, position: true },
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
  showVehicleHistory: true,
  carfaxFetchedAt: true,
  carfaxFetchError: true,
  updatedAt: true,
  images: {
    select: { id: true, url: true, alt: true, position: true },
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
      source: true,
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
    imageCount: row._count.images,
    isFavourited: favouritedIds.has(row.id),
    hasInspection: Boolean(inspection),
    inspectionGrade: inspection?.overallGrade ?? null,
    carfaxUrl: row.carfaxUrl,
    carfaxOneOwner: row.carfaxOneOwner,
    carfaxLowKilometres: row.carfaxLowKilometres,
    activeAuction: auction ? toEmbeddedAuction(auction) : null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Builds the detail response.
 *
 * `includeDocuments` and `includeCarfaxStatus` both default to false so a
 * caller has to say, explicitly, that this viewer is allowed to see them —
 * the seller and an admin, in practice always both flags together, since it
 * is the same "owns this listing" check either way. The documents themselves
 * are addressed by an authorized API route rather than by their location in
 * storage, so the response never discloses where the file actually lives.
 * `includeCarfaxStatus` gates `carfaxFetchedAt`/`carfaxFetchError` — internal
 * extraction diagnostics with no reason to reach a buyer — the same way, per
 * D-036's own rule that an unpublished CARFAX finding is withheld by the API
 * itself rather than merely left undrawn by the page.
 */
export function toVehicleDetail(
  row: VehicleDetailRow,
  favouritedIds: ReadonlySet<string>,
  options: { includeDocuments?: boolean; includeCarfaxStatus?: boolean } = {},
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
    images: row.images.map((image) => ({
      id: image.id,
      url: image.url,
      alt: image.alt,
      position: image.position,
    })),
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
    // Unfiltered for the owner and an admin, who see every CARFAX-sourced row
    // regardless of `showVehicleHistory` — the edit page needs it to preview
    // what was extracted before deciding whether to publish it. Anyone else
    // sees a `CARFAX` row only once that toggle is on; a `SELLER` row is
    // always shown, to everyone, exactly as before this feature existed.
    historyEvents: row.historyEvents
      .filter(
        (event) =>
          event.source !== 'CARFAX' || options.includeCarfaxStatus || row.showVehicleHistory,
      )
      .map((event) => ({
        id: event.id,
        kind: event.kind,
        source: event.source,
        occurredOn: asDate(event.occurredOn),
        label: event.label,
        detail: event.detail,
      })),
    showVehicleHistory: row.showVehicleHistory,
    carfaxFetchedAt: options.includeCarfaxStatus
      ? (row.carfaxFetchedAt?.toISOString() ?? null)
      : null,
    carfaxFetchError: options.includeCarfaxStatus ? row.carfaxFetchError : null,
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
