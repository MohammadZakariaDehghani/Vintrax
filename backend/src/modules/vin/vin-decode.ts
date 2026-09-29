import {
  vinCheckDigitMatches,
  type BodyType,
  type Drivetrain,
  type FuelType,
  type Transmission,
  type VinDecodeResult,
} from '@vintrax/shared';

/**
 * The fields of NHTSA vPIC's `DecodeVinValues` answer this reads. vPIC returns
 * every value as a string, and an empty string for anything it does not know.
 */
export type VpicValues = Partial<Record<string, string | null>>;

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed !== 'Not Applicable' ? trimmed : null;
};

const integer = (value: string | null | undefined): number | null => {
  const number = Number.parseInt(text(value) ?? '', 10);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const decimal = (value: string | null | undefined): number | null => {
  const number = Number.parseFloat(text(value) ?? '');
  return Number.isFinite(number) && number > 0 ? Math.round(number * 10) / 10 : null;
};

/** Makes whose name is not simply capitalised word by word. */
const MAKE_NAMES: Record<string, string> = {
  BMW: 'BMW',
  GMC: 'GMC',
  MINI: 'MINI',
  'MERCEDES-BENZ': 'Mercedes-Benz',
  'ROLLS-ROYCE': 'Rolls-Royce',
  RAM: 'Ram',
  SRT: 'SRT',
};

/** "HONDA" → "Honda", "LAND ROVER" → "Land Rover". */
export function makeName(raw: string | null | undefined): string | null {
  const make = text(raw);
  if (!make) return null;
  const upper = make.toUpperCase();
  if (MAKE_NAMES[upper]) return MAKE_NAMES[upper]!;
  return make
    .toLowerCase()
    .replace(
      /(^|[\s-])([a-z])/g,
      (_, separator: string, letter: string) => separator + letter.toUpperCase(),
    );
}

export function bodyTypeFrom(bodyClass: string | null | undefined): BodyType | null {
  const value = (text(bodyClass) ?? '').toLowerCase();
  if (!value) return null;
  if (/sport utility|suv|crossover|mpv/.test(value)) return 'SUV';
  if (/pickup|truck/.test(value)) return 'TRUCK';
  if (/minivan/.test(value)) return 'MINIVAN';
  if (/convertible|cabriolet|roadster/.test(value)) return 'CONVERTIBLE';
  if (/wagon/.test(value)) return 'WAGON';
  if (/hatchback|liftback/.test(value)) return 'HATCHBACK';
  if (/coupe/.test(value)) return 'COUPE';
  if (/sedan|saloon/.test(value)) return 'SEDAN';
  if (/van/.test(value)) return 'VAN';
  return null;
}

export function drivetrainFrom(driveType: string | null | undefined): Drivetrain | null {
  const value = (text(driveType) ?? '').toLowerCase();
  if (!value) return null;
  if (/awd|all[- ]wheel/.test(value)) return 'AWD';
  if (/4wd|4x4|4-wheel|four[- ]wheel/.test(value)) return 'FOUR_WHEEL_DRIVE';
  if (/fwd|front[- ]wheel/.test(value)) return 'FWD';
  if (/rwd|rear[- ]wheel/.test(value)) return 'RWD';
  return 'OTHER';
}

export function transmissionFrom(style: string | null | undefined): Transmission | null {
  const value = (text(style) ?? '').toLowerCase();
  if (!value) return null;
  if (/continuously|cvt/.test(value)) return 'CVT';
  if (/dual[- ]clutch|dct/.test(value)) return 'DUAL_CLUTCH';
  if (/manual/.test(value)) return 'MANUAL';
  if (/automatic|auto/.test(value)) return 'AUTOMATIC';
  return 'OTHER';
}

export function fuelTypeFrom(
  primary: string | null | undefined,
  electrification: string | null | undefined,
): FuelType | null {
  const level = (text(electrification) ?? '').toLowerCase();
  if (/phev|plug-in/.test(level)) return 'PLUG_IN_HYBRID';
  if (/bev|battery electric/.test(level)) return 'ELECTRIC';
  if (/hev|hybrid/.test(level)) return 'HYBRID';
  const fuel = (text(primary) ?? '').toLowerCase();
  if (!fuel) return null;
  if (/diesel/.test(fuel)) return 'DIESEL';
  if (/electric/.test(fuel)) return 'ELECTRIC';
  if (/hydrogen|fuel cell/.test(fuel)) return 'HYDROGEN';
  if (/gasoline|petrol|flexible|ethanol/.test(fuel)) return 'GASOLINE';
  return null;
}

const DRIVE_SHORT: Record<Drivetrain, string> = {
  FWD: 'FWD',
  RWD: 'RWD',
  AWD: 'AWD',
  FOUR_WHEEL_DRIVE: '4WD',
  OTHER: '',
};

const FUEL_NAME: Record<FuelType, string> = {
  GASOLINE: 'Gasoline',
  DIESEL: 'Diesel',
  HYBRID: 'Hybrid',
  PLUG_IN_HYBRID: 'Plug-in hybrid',
  ELECTRIC: 'Electric',
  HYDROGEN: 'Hydrogen',
};

/** vPIC's answer as the fields the Vintrax form fills in. */
export function toVinDecodeResult(vin: string, values: VpicValues): VinDecodeResult {
  const make = makeName(values['Make']);
  const model = text(values['Model']);
  const trim = text(values['Trim']) ?? text(values['Series']);
  const drivetrain = drivetrainFrom(values['DriveType']);
  const transmission = transmissionFrom(values['TransmissionStyle']);
  const fuelType = fuelTypeFrom(values['FuelTypePrimary'], values['ElectrificationLevel']);
  const engineSizeL = decimal(values['DisplacementL']);
  const cylinders = integer(values['EngineCylinders']);
  const horsepower = integer(values['EngineHP']);

  const engine =
    engineSizeL || cylinders
      ? [
          engineSizeL ? `${engineSizeL.toFixed(1)}L` : null,
          cylinders ? `${cylinders}-cylinder` : null,
        ]
          .filter(Boolean)
          .join(' ')
      : null;

  const styleName = model
    ? [
        model,
        drivetrain ? DRIVE_SHORT[drivetrain] : null,
        trim,
        transmission === 'AUTOMATIC' ? 'Auto' : transmission === 'MANUAL' ? 'Manual' : transmission,
      ]
        .filter(Boolean)
        .join(' ')
    : null;
  const styleDetail = [
    fuelType ? FUEL_NAME[fuelType] : null,
    engineSizeL ? `${engineSizeL.toFixed(1)}L` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return {
    vin,
    checkDigitValid: vinCheckDigitMatches(vin),
    make,
    model,
    year: integer(values['ModelYear']),
    trim,
    style: styleName ? (styleDetail ? `${styleName} (${styleDetail})` : styleName) : null,
    bodyType: bodyTypeFrom(values['BodyClass']),
    drivetrain,
    transmission,
    fuelType,
    engine,
    engineSizeL,
    cylinders,
    doors: integer(values['Doors']),
    seats: integer(values['Seats']),
    horsepower,
  };
}
