import {
  EQUIPMENT_ITEMS,
  MIN_MODEL_YEAR,
  VIN_PATTERN,
  listingQuality,
  maxModelYear,
  youTubeVideoId,
  type ListingQuality,
  type TitleStatus,
  type VehicleDetail,
  type VinDecodeResult,
} from '@vintrax/shared';

/**
 * Everything the dealer's listing form holds, as the inputs hold it: text.
 * Converted to the API's types only when saved (`toPayload`), so a half-typed
 * number never has to be a number.
 */
export interface ListingDraft {
  // VIN & model
  vin: string;
  stockNumber: string;
  make: string;
  model: string;
  year: string;
  trim: string;
  style: string;
  bodyType: string;
  title: string;
  province: string;
  city: string;
  // Features
  doors: string;
  seats: string;
  exteriorColour: string;
  manufacturerColour: string;
  interiorColour: string;
  curbWeightLbs: string;
  // Condition
  condition: string;
  isDamaged: '' | 'yes' | 'no';
  mileageKm: string;
  ownerCount: string;
  availability: string;
  extendedWarranty: '' | 'yes' | 'no';
  titleStatus: TitleStatus | '';
  // Equipment
  equipment: string[];
  otherFeatures: string;
  // Transmission & engine
  fuelType: string;
  drivetrain: string;
  transmission: string;
  horsepower: string;
  engine: string;
  engineSizeL: string;
  cylinders: string;
  // Image & video
  images: Array<{ url: string; alt?: string }>;
  videoUrl: string;
  // Description
  description: string;
  // Price
  priceCad: string;
  salePriceCad: string;
  msrpCad: string;
  invoicePriceCad: string;
  retailPriceCad: string;
  wholesalePriceCad: string;
  saleChannel: string;
}

export type DraftField = keyof ListingDraft;

export const BLANK_DRAFT: ListingDraft = {
  vin: '',
  stockNumber: '',
  make: '',
  model: '',
  year: '',
  trim: '',
  style: '',
  bodyType: '',
  title: '',
  province: '',
  city: '',
  doors: '',
  seats: '',
  exteriorColour: '',
  manufacturerColour: '',
  interiorColour: '',
  curbWeightLbs: '',
  condition: 'USED',
  isDamaged: '',
  mileageKm: '',
  ownerCount: '',
  availability: 'IMMEDIATELY',
  extendedWarranty: '',
  titleStatus: '',
  equipment: [],
  otherFeatures: '',
  fuelType: '',
  drivetrain: '',
  transmission: '',
  horsepower: '',
  engine: '',
  engineSizeL: '',
  cylinders: '',
  images: [],
  videoUrl: '',
  description: '',
  priceCad: '',
  salePriceCad: '',
  msrpCad: '',
  invoicePriceCad: '',
  retailPriceCad: '',
  wholesalePriceCad: '',
  saleChannel: 'FIXED_PRICE',
};

const str = (value: string | number | null | undefined) =>
  value === null || value === undefined ? '' : String(value);
const yesNo = (value: boolean | null | undefined): '' | 'yes' | 'no' =>
  value === true ? 'yes' : value === false ? 'no' : '';

/** A new draft with what the VIN decoder read already filled in. */
export function draftFromDecode(
  base: ListingDraft,
  decoded: VinDecodeResult,
  style?: string,
): ListingDraft {
  return {
    ...base,
    vin: decoded.vin,
    make: decoded.make ?? base.make,
    model: decoded.model ?? base.model,
    year: decoded.year ? String(decoded.year) : base.year,
    trim: decoded.trim ?? base.trim,
    style: style ?? decoded.style ?? '',
    bodyType: decoded.bodyType ?? base.bodyType,
    drivetrain: decoded.drivetrain ?? base.drivetrain,
    transmission: decoded.transmission ?? base.transmission,
    fuelType: decoded.fuelType ?? base.fuelType,
    engine: decoded.engine ?? base.engine,
    engineSizeL: decoded.engineSizeL ? String(decoded.engineSizeL) : base.engineSizeL,
    cylinders: decoded.cylinders ? String(decoded.cylinders) : base.cylinders,
    doors: decoded.doors ? String(decoded.doors) : base.doors,
    seats: decoded.seats ? String(decoded.seats) : base.seats,
    horsepower: decoded.horsepower ? String(decoded.horsepower) : base.horsepower,
  };
}

/** An existing listing, as the form edits it. */
export function draftFromVehicle(vehicle: VehicleDetail): ListingDraft {
  const prices = vehicle.referencePrices;
  return {
    ...BLANK_DRAFT,
    vin: vehicle.vin ?? '',
    stockNumber: vehicle.stockNumber ?? '',
    make: vehicle.make,
    model: vehicle.model,
    year: String(vehicle.year),
    trim: vehicle.trim ?? '',
    bodyType: vehicle.bodyType,
    title: vehicle.title,
    province: vehicle.province,
    city: vehicle.city,
    doors: str(vehicle.doors),
    seats: str(vehicle.seats),
    exteriorColour: vehicle.exteriorColour ?? '',
    manufacturerColour: vehicle.manufacturerColour ?? '',
    interiorColour: vehicle.interiorColour ?? '',
    curbWeightLbs: str(vehicle.curbWeightLbs),
    condition: vehicle.condition,
    isDamaged: yesNo(vehicle.isDamaged),
    mileageKm: String(vehicle.mileageKm),
    ownerCount: str(vehicle.ownerCount),
    availability: vehicle.availability ?? '',
    extendedWarranty: yesNo(vehicle.extendedWarranty),
    titleStatus: vehicle.titleStatus ?? '',
    equipment: vehicle.features.filter((feature) => EQUIPMENT_ITEMS.has(feature)),
    otherFeatures: vehicle.features.filter((feature) => !EQUIPMENT_ITEMS.has(feature)).join(', '),
    fuelType: vehicle.fuelType,
    drivetrain: vehicle.drivetrain,
    transmission: vehicle.transmission,
    horsepower: str(vehicle.horsepower),
    engine: vehicle.engine ?? '',
    engineSizeL: str(vehicle.engineSizeL),
    cylinders: str(vehicle.cylinders),
    images: vehicle.images.map((image) => ({ url: image.url, alt: image.alt ?? undefined })),
    videoUrl: vehicle.videoUrl ?? '',
    description: vehicle.description,
    priceCad: String(vehicle.priceCad),
    salePriceCad: str(prices?.salePriceCad),
    msrpCad: str(prices?.msrpCad),
    invoicePriceCad: str(prices?.invoicePriceCad),
    retailPriceCad: str(prices?.retailPriceCad),
    wholesalePriceCad: str(prices?.wholesalePriceCad),
    saleChannel: vehicle.saleChannel,
  };
}

/** "2000 Honda CR-V SE": the headline used when the dealer writes none. */
export function autoTitle(draft: ListingDraft): string {
  return [draft.year, draft.make, draft.model, draft.trim]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

export function otherFeatureList(draft: ListingDraft): string[] {
  return draft.otherFeatures
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Every feature, ticked and typed, without repeats. */
export function allFeatures(draft: ListingDraft): string[] {
  return [...new Set([...draft.equipment, ...otherFeatureList(draft)])];
}

// --- Validation --------------------------------------------------------------

export type DraftErrors = Partial<Record<DraftField, string>>;

const digits = (value: string) => value.replace(/[\s,$]/g, '');

function wholeNumber(value: string, min: number, max: number, message: string): string | undefined {
  if (!value.trim()) return undefined;
  const number = Number(digits(value));
  return Number.isInteger(number) && number >= min && number <= max ? undefined : message;
}

/**
 * What stops the listing being saved, field by field. Mirrors the server's
 * rules so the dealer hears about a problem next to the field, before saving,
 * rather than in a list after it.
 */
export function validateDraft(draft: ListingDraft): DraftErrors {
  const errors: DraftErrors = {};
  const need = (field: DraftField, message: string) => {
    const value = draft[field];
    if (typeof value === 'string' && !value.trim()) errors[field] = message;
  };

  // VIN & model
  const vin = draft.vin.trim().toUpperCase();
  if (vin && !VIN_PATTERN.test(vin)) {
    errors.vin = `A VIN is 17 letters and digits, without I, O or Q (${vin.length}/17).`;
  }
  if (!vin && !draft.stockNumber.trim()) {
    errors.stockNumber = 'Enter a VIN or a stock number.';
  }
  need('make', 'Enter the brand.');
  need('model', 'Enter the model.');
  const year = Number(draft.year);
  if (!draft.year.trim()) errors.year = 'Choose the model year.';
  else if (!Number.isInteger(year) || year < MIN_MODEL_YEAR || year > maxModelYear()) {
    errors.year = `Enter a year between ${MIN_MODEL_YEAR} and ${maxModelYear()}.`;
  }
  need('bodyType', 'Choose the body style.');
  if (draft.title.trim() && draft.title.trim().length < 6) {
    errors.title =
      'A headline needs at least 6 characters — or leave it blank to use the model name.';
  }
  need('province', 'Choose the province.');
  need('city', 'Enter the city the vehicle is in.');

  // Features
  const doors = wholeNumber(draft.doors, 0, 8, 'Enter between 0 and 8 doors.');
  if (doors) errors.doors = doors;
  const seats = wholeNumber(draft.seats, 0, 60, 'Enter between 0 and 60 seats.');
  if (seats) errors.seats = seats;
  const weight = wholeNumber(
    draft.curbWeightLbs,
    100,
    30_000,
    'Enter a weight between 100 and 30,000 lbs.',
  );
  if (weight) errors.curbWeightLbs = weight;
  if (draft.manufacturerColour.trim().length > 30) {
    errors.manufacturerColour = 'At most 30 characters.';
  }

  // Condition
  need('condition', 'Choose the vehicle condition.');
  if (!draft.mileageKm.trim()) {
    errors.mileageKm = 'Please enter a value between 0 and 2,000,000 km.';
  } else {
    const mileage = wholeNumber(
      draft.mileageKm,
      0,
      2_000_000,
      'Please enter a value between 0 and 2,000,000 km.',
    );
    if (mileage) errors.mileageKm = mileage;
  }

  // Transmission & engine
  need('fuelType', 'Choose the fuel type.');
  need('drivetrain', 'Choose the drive type.');
  need('transmission', 'Choose the transmission.');
  const power = wholeNumber(draft.horsepower, 1, 2_000, 'Enter between 1 and 2,000 hp.');
  if (power) errors.horsepower = power;
  if (draft.engineSizeL.trim()) {
    const size = Number(draft.engineSizeL);
    if (!Number.isFinite(size) || size < 0 || size > 20)
      errors.engineSizeL = 'Enter a size between 0 and 20 L.';
  }
  const cylinders = wholeNumber(draft.cylinders, 0, 16, 'Enter between 0 and 16 cylinders.');
  if (cylinders) errors.cylinders = cylinders;

  // Image & video
  if (draft.videoUrl.trim() && !youTubeVideoId(draft.videoUrl)) {
    errors.videoUrl = 'Use a YouTube video or Shorts link.';
  }

  // Description
  const length = draft.description.trim().length;
  if (length < 20) {
    errors.description =
      length === 0
        ? 'Describe the vehicle — at least 20 characters.'
        : `Write at least 20 characters — ${20 - length} more to go.`;
  }

  // Price
  if (!draft.priceCad.trim()) errors.priceCad = 'Enter the asking price.';
  else {
    const price = wholeNumber(
      draft.priceCad,
      1,
      10_000_000,
      'Enter a price between $1 and $10,000,000.',
    );
    if (price) errors.priceCad = price;
  }
  for (const field of [
    'salePriceCad',
    'msrpCad',
    'invoicePriceCad',
    'retailPriceCad',
    'wholesalePriceCad',
  ] as const) {
    const message = wholeNumber(draft[field], 0, 10_000_000, 'Enter a whole-dollar amount.');
    if (message) errors[field] = message;
  }

  return errors;
}

// --- Sections ----------------------------------------------------------------

export interface ListingSection {
  id: string;
  label: string;
  /** Marked with an asterisk; the listing cannot be saved until it is complete. */
  required: boolean;
  fields: DraftField[];
}

export const LISTING_SECTIONS: readonly ListingSection[] = [
  {
    id: 'vin-model',
    label: 'VIN & model',
    required: true,
    fields: [
      'vin',
      'stockNumber',
      'make',
      'model',
      'year',
      'trim',
      'bodyType',
      'title',
      'province',
      'city',
    ],
  },
  {
    id: 'features',
    label: 'Features',
    required: false,
    fields: [
      'doors',
      'seats',
      'exteriorColour',
      'manufacturerColour',
      'interiorColour',
      'curbWeightLbs',
    ],
  },
  {
    id: 'condition',
    label: 'Condition',
    required: true,
    fields: [
      'condition',
      'isDamaged',
      'mileageKm',
      'ownerCount',
      'availability',
      'extendedWarranty',
      'titleStatus',
    ],
  },
  { id: 'equipment', label: 'Equipment', required: false, fields: ['equipment', 'otherFeatures'] },
  {
    id: 'engine',
    label: 'Transmission & engine',
    required: true,
    fields: [
      'fuelType',
      'drivetrain',
      'transmission',
      'horsepower',
      'engine',
      'engineSizeL',
      'cylinders',
    ],
  },
  { id: 'media', label: 'Image & video', required: false, fields: ['images', 'videoUrl'] },
  { id: 'description', label: 'Description', required: true, fields: ['description'] },
  {
    id: 'price',
    label: 'Price',
    required: true,
    fields: [
      'priceCad',
      'salePriceCad',
      'msrpCad',
      'invoicePriceCad',
      'retailPriceCad',
      'wholesalePriceCad',
      'saleChannel',
    ],
  },
  { id: 'quality', label: 'Listing quality', required: false, fields: [] },
];

export type SectionState = 'done' | 'error' | 'todo';

function hasContent(draft: ListingDraft, field: DraftField): boolean {
  const value = draft[field];
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * The mark beside a section in the timeline: a tick when it is complete (or,
 * for an optional section, when something is filled in), an exclamation mark
 * when something in it is wrong or a required part is missing, and otherwise
 * its number.
 */
export function sectionState(
  section: ListingSection,
  draft: ListingDraft,
  errors: DraftErrors,
  quality: ListingQuality,
): SectionState {
  if (section.id === 'quality') return quality.score >= 100 ? 'done' : 'todo';
  if (section.fields.some((field) => errors[field])) return 'error';
  if (section.required) return 'done';
  // Defaults the form fills in for the dealer do not count as their answer.
  const answered = section.fields.filter(
    (field) => field !== 'availability' && field !== 'condition',
  );
  return answered.some((field) => hasContent(draft, field)) ? 'done' : 'todo';
}

export function draftQuality(draft: ListingDraft): ListingQuality {
  const number = (value: string) => (value.trim() ? Number(digits(value)) : null);
  return listingQuality({
    imageCount: draft.images.length,
    description: draft.description,
    features: allFeatures(draft),
    vin: draft.vin,
    trim: draft.trim,
    exteriorColour: draft.exteriorColour,
    interiorColour: draft.interiorColour,
    doors: number(draft.doors),
    seats: number(draft.seats),
    engine: draft.engine,
    horsepower: number(draft.horsepower),
    ownerCount: number(draft.ownerCount),
    isDamaged: draft.isDamaged === '' ? null : draft.isDamaged === 'yes',
  });
}

// --- Saving ------------------------------------------------------------------

const numberOrNull = (value: string): number | null => {
  const trimmed = digits(value);
  return trimmed ? Number(trimmed) : null;
};
const textOrNull = (value: string): string | null => value.trim() || null;
const boolOrNull = (value: '' | 'yes' | 'no'): boolean | null =>
  value === '' ? null : value === 'yes';

/**
 * The create or update body. Blank optional fields are sent as null, which on
 * an edit clears what was stored — a dealer who empties a field means it.
 */
export function toPayload(
  draft: ListingDraft,
  options: { status?: 'DRAFT' | 'PENDING_REVIEW' },
): Record<string, unknown> {
  return {
    title: draft.title.trim() || autoTitle(draft),
    description: draft.description.trim(),
    vin: textOrNull(draft.vin.toUpperCase()),
    stockNumber: textOrNull(draft.stockNumber),
    make: draft.make.trim(),
    model: draft.model.trim(),
    trim: textOrNull(draft.trim),
    year: Number(draft.year),
    bodyType: draft.bodyType,
    province: draft.province,
    city: draft.city.trim(),
    doors: numberOrNull(draft.doors),
    seats: numberOrNull(draft.seats),
    exteriorColour: textOrNull(draft.exteriorColour),
    manufacturerColour: textOrNull(draft.manufacturerColour),
    interiorColour: textOrNull(draft.interiorColour),
    curbWeightLbs: numberOrNull(draft.curbWeightLbs),
    condition: draft.condition,
    isDamaged: boolOrNull(draft.isDamaged),
    mileageKm: Number(digits(draft.mileageKm)),
    ownerCount: numberOrNull(draft.ownerCount),
    availability: textOrNull(draft.availability),
    extendedWarranty: boolOrNull(draft.extendedWarranty),
    // Not sent when unstated: the server never records a title brand for them.
    ...(draft.titleStatus ? { titleStatus: draft.titleStatus } : {}),
    features: allFeatures(draft),
    fuelType: draft.fuelType,
    drivetrain: draft.drivetrain,
    transmission: draft.transmission,
    horsepower: numberOrNull(draft.horsepower),
    engine: textOrNull(draft.engine),
    engineSizeL: draft.engineSizeL.trim() ? Number(draft.engineSizeL) : null,
    cylinders: numberOrNull(draft.cylinders),
    images: draft.images,
    videoUrl: textOrNull(draft.videoUrl),
    priceCad: Number(digits(draft.priceCad)),
    salePriceCad: numberOrNull(draft.salePriceCad),
    msrpCad: numberOrNull(draft.msrpCad),
    invoicePriceCad: numberOrNull(draft.invoicePriceCad),
    retailPriceCad: numberOrNull(draft.retailPriceCad),
    wholesalePriceCad: numberOrNull(draft.wholesalePriceCad),
    saleChannel: draft.saleChannel,
    ...(options.status ? { status: options.status } : {}),
  };
}
