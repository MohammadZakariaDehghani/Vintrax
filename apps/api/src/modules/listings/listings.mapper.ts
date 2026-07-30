import type { Prisma } from '@prisma/client';
import type { ListingDetail, ListingSummary } from '@atlas/shared';

/** Fields needed to render a listing card in search results and dashboards. */
export const listingSummarySelect = {
  id: true,
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
  publishedAt: true,
  createdAt: true,
  images: {
    select: { id: true, url: true, alt: true, position: true },
    orderBy: { position: 'asc' },
    take: 1,
  },
  _count: { select: { images: true } },
} satisfies Prisma.ListingSelect;

export const listingSellerSelect = {
  id: true,
  displayName: true,
  role: true,
  province: true,
  city: true,
  createdAt: true,
  dealership: { select: { id: true, name: true, verified: true } },
} satisfies Prisma.UserSelect;

/** Summary fields plus everything only the detail page needs. */
export const listingDetailSelect = {
  ...listingSummarySelect,
  description: true,
  exteriorColour: true,
  vin: true,
  viewCount: true,
  updatedAt: true,
  images: {
    select: { id: true, url: true, alt: true, position: true },
    orderBy: { position: 'asc' },
  },
  seller: { select: listingSellerSelect },
} satisfies Prisma.ListingSelect;

export type ListingSummaryRow = Prisma.ListingGetPayload<{ select: typeof listingSummarySelect }>;
export type ListingDetailRow = Prisma.ListingGetPayload<{ select: typeof listingDetailSelect }>;

export function toListingSummary(
  row: ListingSummaryRow,
  favouritedIds: ReadonlySet<string>,
): ListingSummary {
  return {
    id: row.id,
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
    primaryImageUrl: row.images[0]?.url ?? null,
    imageCount: row._count.images,
    isFavourited: favouritedIds.has(row.id),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toListingDetail(
  row: ListingDetailRow,
  favouritedIds: ReadonlySet<string>,
): ListingDetail {
  return {
    ...toListingSummary(row, favouritedIds),
    description: row.description,
    exteriorColour: row.exteriorColour,
    vin: row.vin,
    viewCount: row.viewCount,
    updatedAt: row.updatedAt.toISOString(),
    images: row.images.map((image) => ({
      id: image.id,
      url: image.url,
      alt: image.alt,
      position: image.position,
    })),
    seller: {
      id: row.seller.id,
      displayName: row.seller.displayName,
      role: row.seller.role,
      province: row.seller.province,
      city: row.seller.city,
      dealership: row.seller.dealership,
      memberSince: row.seller.createdAt.toISOString(),
    },
  };
}
