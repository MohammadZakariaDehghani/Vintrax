/**
 * What the dealer's "Add a vehicle" form offers, and how complete a listing is.
 *
 * The form is modelled on the flow Canadian dealers already use on the large
 * marketplaces: a VIN first, then one long page of sections — model, features,
 * condition, equipment, drivetrain, photos, description, price — with a
 * listing-quality score at the end. Everything here is plain data and pure
 * functions so the web form, the inventory side panel and the server agree.
 */

import type { BodyType, Drivetrain, FuelType, Transmission } from './domain';

// --- Colours -----------------------------------------------------------------

/** A colour offered as a swatch. `hex` only draws the swatch; `name` is stored. */
export interface ColourSwatch {
  name: string;
  hex: string;
}

export const EXTERIOR_COLOURS: readonly ColourSwatch[] = [
  { name: 'Beige', hex: '#d8b98a' },
  { name: 'Black', hex: '#111111' },
  { name: 'Blue', hex: '#1d5fc4' },
  { name: 'Bronze', hex: '#c98b5a' },
  { name: 'Brown', hex: '#7a3f12' },
  { name: 'Gold', hex: '#d9b233' },
  { name: 'Green', hex: '#2f9e44' },
  { name: 'Grey', hex: '#8a8f98' },
  { name: 'Orange', hex: '#f07c1b' },
  { name: 'Red', hex: '#d6202a' },
  { name: 'Silver', hex: '#c7ccd3' },
  { name: 'Violet', hex: '#86248f' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Yellow', hex: '#f5c518' },
];

export const INTERIOR_COLOURS: readonly ColourSwatch[] = [
  { name: 'Beige', hex: '#d8b98a' },
  { name: 'Black', hex: '#111111' },
  { name: 'Blue', hex: '#1d5fc4' },
  { name: 'Brown', hex: '#7a3f12' },
  { name: 'Green', hex: '#2f9e44' },
  { name: 'Grey', hex: '#8a8f98' },
  { name: 'Orange', hex: '#f07c1b' },
  { name: 'Red', hex: '#d6202a' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Yellow', hex: '#f5c518' },
  { name: 'Other', hex: '#2b2b2b' },
];

// --- Condition ---------------------------------------------------------------

export const VEHICLE_AVAILABILITIES = [
  'IMMEDIATELY',
  'WITHIN_A_WEEK',
  'WITHIN_A_MONTH',
  'ON_ORDER',
] as const;
export type VehicleAvailability = (typeof VEHICLE_AVAILABILITIES)[number];

export const VEHICLE_AVAILABILITY_LABELS: Record<VehicleAvailability, string> = {
  IMMEDIATELY: 'Immediately',
  WITHIN_A_WEEK: 'Within a week',
  WITHIN_A_MONTH: 'Within a month',
  ON_ORDER: 'On order',
};

/** Owners offered in the form; the last one means "this many or more". */
export const OWNER_COUNT_OPTIONS = [1, 2, 3, 4, 5] as const;
export const MAX_OWNER_COUNT = 5;

export function ownerCountLabel(count: number): string {
  if (count >= MAX_OWNER_COUNT) return `${MAX_OWNER_COUNT} or more owners`;
  return count === 1 ? '1 owner' : `${count} owners`;
}

// --- Equipment ---------------------------------------------------------------

export interface EquipmentGroup {
  name: string;
  items: readonly string[];
}

/**
 * The equipment a dealer ticks, in groups. A ticked item is stored as its name
 * in the listing's `features`, so listings saved before this catalogue existed
 * — and anything typed under "Other features" — keep working unchanged.
 */
export const EQUIPMENT_GROUPS: readonly EquipmentGroup[] = [
  {
    name: 'Air conditioning',
    items: [
      'Air conditioning',
      'Automatic climate control',
      'Automatic climate control, dual-zone',
    ],
  },
  {
    name: 'Airbags',
    items: ['Driver-side airbag', 'Passenger-side airbag', 'Side airbags', 'Curtain airbags'],
  },
  {
    name: 'Assistance systems',
    items: [
      'Blind spot monitor',
      'Front collision warning',
      'Lane departure warning',
      'Lane keeping assist',
      'Traffic sign recognition',
    ],
  },
  {
    name: 'Central locking',
    items: ['Power door locks', 'Remote keyless entry', 'Push-button start'],
  },
  {
    name: 'Comfort',
    items: [
      'Air suspension',
      'Armrest',
      'Heads-up display',
      'Heated steering wheel',
      'Leather steering wheel',
      'Panoramic roof',
      'Power windows',
      'Power steering',
      'Power mirrors',
      'Rain-sensing wipers',
      'Sliding door',
      'Start-stop system',
      'Sunroof / moonroof',
      'Power liftgate',
    ],
  },
  { name: 'Cruise control', items: ['Adaptive cruise control', 'Cruise control'] },
  {
    name: 'Entertainment',
    items: [
      'Apple CarPlay',
      'Android Auto',
      'Digital cockpit',
      'Integrated music streaming',
      'Premium sound system',
      'Rear-seat entertainment',
      'Voice control',
      'Wireless charging',
    ],
  },
  {
    name: 'Extras',
    items: [
      'Alloy wheels',
      'Ambient lighting',
      'Auto-dimming rearview mirror',
      'Rear spoiler',
      'Roof rack',
      'Spare tire',
      'Tinted windows',
      'Trailer hitch',
      'Winter tires',
      'Remote start',
    ],
  },
  {
    name: 'Infotainment',
    items: [
      'AM/FM stereo',
      'Bluetooth connection',
      'CD player',
      'MP3 player',
      'Navigation system',
      'On-board computer',
      'Satellite radio',
      'Steering wheel audio controls',
      'USB port',
    ],
  },
  {
    name: 'Lights',
    items: [
      'Auto-levelling headlights',
      'Automatic headlights',
      'Daytime running lights',
      'Fog lights',
      'LED headlights',
    ],
  },
  {
    name: 'Parking assistance',
    items: [
      '360° camera',
      'Back-up camera',
      'Parking sensors, front',
      'Parking sensors, rear',
      'Self-parking',
    ],
  },
  {
    name: 'Seats',
    items: [
      'Cooled seats',
      'Heated seats',
      'Heated rear seats',
      'Leather seats',
      'Memory seats',
      'Power seats',
      'Split bench seat',
      'Third-row seating',
    ],
  },
  {
    name: 'Security',
    items: [
      'Alarm',
      'Anti-lock brakes (ABS)',
      'Electronic stability control',
      'Engine immobilizer',
      'Tire pressure monitoring',
      'Traction control',
    ],
  },
];

/** Every catalogue item, for telling a ticked item from a typed one. */
export const EQUIPMENT_ITEMS: ReadonlySet<string> = new Set(
  EQUIPMENT_GROUPS.flatMap((group) => group.items),
);

/** How many features one listing may carry: the whole catalogue and then some. */
export const MAX_VEHICLE_FEATURES = 150;

// --- VIN ---------------------------------------------------------------------

const VIN_VALUES: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Whether a 17-character VIN's ninth character is the check digit its other
 * characters produce. Every North American VIN has one; many built for other
 * markets do not, so a mismatch is a reason to look again, not a refusal.
 */
export function vinCheckDigitMatches(vin: string): boolean {
  const value = vin.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 17; index += 1) {
    const char = value[index]!;
    const number = /\d/.test(char) ? Number(char) : VIN_VALUES[char];
    if (number === undefined) return false;
    sum += number * VIN_WEIGHTS[index]!;
  }
  const remainder = sum % 11;
  return value[8] === (remainder === 10 ? 'X' : String(remainder));
}

// --- Video -------------------------------------------------------------------

const YOUTUBE_URL =
  /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#/][^\s]*)?$/;

/** The video id of a YouTube watch, share, Shorts or embed link, or null. */
export function youTubeVideoId(url: string): string | null {
  return YOUTUBE_URL.exec(url.trim())?.[1] ?? null;
}

/** Where a listing frames its video: YouTube's no-cookie player, built from the id alone. */
export function youTubeEmbedUrl(url: string): string | null {
  const id = youTubeVideoId(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

// --- Listing quality ---------------------------------------------------------

/** What the listing-quality score reads. Every field is optional so a half-filled form can be scored. */
export interface ListingQualityInput {
  imageCount: number;
  description?: string | null;
  features?: readonly string[] | null;
  vin?: string | null;
  trim?: string | null;
  exteriorColour?: string | null;
  interiorColour?: string | null;
  doors?: number | null;
  seats?: number | null;
  engine?: string | null;
  horsepower?: number | null;
  ownerCount?: number | null;
  isDamaged?: boolean | null;
}

export type ListingQualityArea = 'PHOTOS' | 'DESCRIPTION' | 'VEHICLE_DATA';

export interface ListingQualityTip {
  area: ListingQualityArea;
  /** True when this area needs no more work. */
  done: boolean;
  message: string;
}

export interface ListingQuality {
  /** 0–100. */
  score: number;
  tips: ListingQualityTip[];
}

/** Photos a listing needs for full marks. */
export const QUALITY_PHOTO_TARGET = 10;
/** Description length, in characters, for full marks. */
export const QUALITY_DESCRIPTION_TARGET = 300;

/**
 * How complete a listing is, out of 100: photos 40, description 20, vehicle
 * data 40. Deliberately simple and explainable — the dealer sees exactly which
 * area costs them points and what fixes it.
 */
export function listingQuality(input: ListingQualityInput): ListingQuality {
  const photos = Math.min(input.imageCount, QUALITY_PHOTO_TARGET) / QUALITY_PHOTO_TARGET;
  const descriptionLength = input.description?.trim().length ?? 0;
  const description =
    Math.min(descriptionLength, QUALITY_DESCRIPTION_TARGET) / QUALITY_DESCRIPTION_TARGET;

  const dataPoints = [
    Boolean(input.vin),
    Boolean(input.trim),
    Boolean(input.exteriorColour),
    Boolean(input.interiorColour),
    Boolean(input.doors),
    Boolean(input.seats),
    Boolean(input.engine) || Boolean(input.horsepower),
    (input.features?.length ?? 0) >= 5,
    input.ownerCount !== null && input.ownerCount !== undefined,
    input.isDamaged !== null && input.isDamaged !== undefined,
  ];
  const data = dataPoints.filter(Boolean).length / dataPoints.length;

  const score = Math.round(photos * 40 + description * 20 + data * 40);

  const tips: ListingQualityTip[] = [
    {
      area: 'PHOTOS',
      done: input.imageCount >= QUALITY_PHOTO_TARGET,
      message:
        input.imageCount >= QUALITY_PHOTO_TARGET
          ? 'The number of photos is excellent.'
          : input.imageCount === 0
            ? `Add photos — listings with at least ${QUALITY_PHOTO_TARGET} get far more enquiries.`
            : `Add ${QUALITY_PHOTO_TARGET - input.imageCount} more photo${QUALITY_PHOTO_TARGET - input.imageCount === 1 ? '' : 's'}: the front at an angle, the interior, the odometer and any damage.`,
    },
    {
      area: 'DESCRIPTION',
      done: descriptionLength >= QUALITY_DESCRIPTION_TARGET,
      message:
        descriptionLength >= QUALITY_DESCRIPTION_TARGET
          ? 'Your vehicle description is excellent.'
          : 'Write a longer description: service history, recent work, tires, and why it is a good buy.',
    },
    {
      area: 'VEHICLE_DATA',
      done: data === 1,
      message:
        data === 1
          ? 'Your vehicle data is complete.'
          : 'Fill in the remaining details — VIN, trim, colours, doors, seats, engine, owners, damage and at least five pieces of equipment.',
    },
  ];

  return { score, tips };
}

// --- VIN decoding ------------------------------------------------------------

/** What `GET /vin/:vin` read from a VIN. Anything the decoder did not know is null. */
export interface VinDecodeResult {
  vin: string;
  /** Whether the ninth character is the check digit (see `vinCheckDigitMatches`). */
  checkDigitValid: boolean;
  make: string | null;
  model: string | null;
  year: number | null;
  trim: string | null;
  /** One line naming the version, e.g. "CR-V 4WD SE Automatic (Gasoline, 2.0L)". */
  style: string | null;
  bodyType: BodyType | null;
  drivetrain: Drivetrain | null;
  transmission: Transmission | null;
  fuelType: FuelType | null;
  engine: string | null;
  engineSizeL: number | null;
  cylinders: number | null;
  doors: number | null;
  seats: number | null;
  horsepower: number | null;
}
