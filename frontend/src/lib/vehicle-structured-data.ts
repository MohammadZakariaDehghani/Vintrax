import type { PublicReviewPage, VehicleDetail } from '@vintrax/shared';

const BODY_TYPE: Partial<Record<VehicleDetail['bodyType'], string>> = {
  SEDAN: 'Sedan',
  SUV: 'SUV',
  TRUCK: 'Pickup truck',
  COUPE: 'Coupe',
  HATCHBACK: 'Hatchback',
  CONVERTIBLE: 'Convertible',
  WAGON: 'Station wagon',
  MINIVAN: 'Minivan',
  VAN: 'Van',
};

const FUEL: Partial<Record<VehicleDetail['fuelType'], string>> = {
  GASOLINE: 'Gasoline',
  DIESEL: 'Diesel',
  HYBRID: 'Hybrid',
  PLUG_IN_HYBRID: 'Plug-in hybrid',
  ELECTRIC: 'Electric',
  HYDROGEN: 'Hydrogen',
};

const TRANSMISSION: Partial<Record<VehicleDetail['transmission'], string>> = {
  AUTOMATIC: 'AutomaticTransmission',
  MANUAL: 'ManualTransmission',
};

const DRIVE: Partial<Record<VehicleDetail['drivetrain'], string>> = {
  FWD: 'FrontWheelDriveConfiguration',
  RWD: 'RearWheelDriveConfiguration',
  AWD: 'AllWheelDriveConfiguration',
  FOUR_WHEEL_DRIVE: 'FourWheelDriveConfiguration',
};

const CONDITION: Record<VehicleDetail['condition'], string> = {
  NEW: 'NewCondition',
  USED: 'UsedCondition',
  CERTIFIED_PRE_OWNED: 'UsedCondition',
  SALVAGE: 'DamagedCondition',
};

/** Only the listing states in which the car can actually be bought. */
const AVAILABILITY: Partial<Record<VehicleDetail['status'], string>> = {
  ACTIVE: 'https://schema.org/InStock',
  IN_AUCTION: 'https://schema.org/InStock',
  SOLD: 'https://schema.org/SoldOut',
};

/**
 * schema.org `Car` markup for a vehicle page, so search engines can show
 * price, mileage and availability with the result.
 *
 * Built only from what the listing states: a field the seller left empty is
 * left out rather than guessed, and an offer is only described for a car
 * that is on sale (or sold) at a stated price.
 */
export function vehicleStructuredData(
  vehicle: VehicleDetail,
  pageUrl: string,
  absolute: (path: string) => string,
): Record<string, unknown> {
  const images = vehicle.images.map((image) => absolute(image.url));
  const seller = vehicle.seller.dealer
    ? { '@type': 'AutoDealer', name: vehicle.seller.dealer.name }
    : { '@type': 'Person', name: vehicle.seller.displayName };
  const availability = AVAILABILITY[vehicle.status];

  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Car',
    name: vehicle.title,
    url: pageUrl,
    brand: { '@type': 'Brand', name: vehicle.make },
    model: vehicle.model,
    vehicleModelDate: String(vehicle.year),
    mileageFromOdometer: {
      '@type': 'QuantitativeValue',
      value: vehicle.mileageKm,
      unitCode: 'KMT',
    },
    itemCondition: `https://schema.org/${CONDITION[vehicle.condition]}`,
  };
  if (vehicle.description) data['description'] = vehicle.description.slice(0, 5000);
  if (images.length > 0) data['image'] = images;
  if (vehicle.vin) data['vehicleIdentificationNumber'] = vehicle.vin;
  if (vehicle.trim) data['vehicleConfiguration'] = vehicle.trim;
  if (BODY_TYPE[vehicle.bodyType]) data['bodyType'] = BODY_TYPE[vehicle.bodyType];
  if (FUEL[vehicle.fuelType]) data['fuelType'] = FUEL[vehicle.fuelType];
  if (TRANSMISSION[vehicle.transmission]) {
    data['vehicleTransmission'] = `https://schema.org/${TRANSMISSION[vehicle.transmission]}`;
  }
  if (DRIVE[vehicle.drivetrain]) {
    data['driveWheelConfiguration'] = `https://schema.org/${DRIVE[vehicle.drivetrain]}`;
  }
  if (vehicle.exteriorColour) data['color'] = vehicle.exteriorColour;
  if (vehicle.doors) data['numberOfDoors'] = vehicle.doors;
  if (vehicle.seats) data['seatingCapacity'] = vehicle.seats;

  if (vehicle.priceCad > 0 && availability) {
    data['offers'] = {
      '@type': 'Offer',
      url: pageUrl,
      price: vehicle.priceCad,
      priceCurrency: 'CAD',
      availability,
      seller,
      areaServed: { '@type': 'Place', name: `${vehicle.city}, ${vehicle.province}` },
    };
  }
  return data;
}

/**
 * Adds the vehicle's approved reviews to its `Car` markup: the rating over
 * every approved review, and the approved reviews shown on the page. Nothing
 * is added without an approved review, so the markup never claims a rating
 * the page does not show. Authors appear by the name shown on the page only.
 */
export function withReviews(
  data: Record<string, unknown>,
  reviews: PublicReviewPage | null,
): Record<string, unknown> {
  const summary = reviews?.summary;
  if (!reviews || !summary || !summary.total || summary.average === null) return data;
  return {
    ...data,
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: summary.average,
      reviewCount: summary.total,
      bestRating: 5,
      worstRating: 1,
    },
    review: reviews.reviews.map((review) => ({
      '@type': 'Review',
      reviewRating: {
        '@type': 'Rating',
        ratingValue: review.rating,
        bestRating: 5,
        worstRating: 1,
      },
      author: { '@type': 'Person', name: review.displayName },
      datePublished: review.createdAt.slice(0, 10),
      reviewBody: review.content,
    })),
  };
}

/**
 * The markup as script text. `<` is escaped so a title or description
 * containing `</script>` cannot close the element early.
 */
export function jsonLdScript(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
