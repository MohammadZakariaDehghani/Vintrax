/**
 * Seeds a realistic Canadian demo marketplace.
 *
 * Safe to re-run: everything is keyed by a natural identifier (user email,
 * vehicle VIN) and upserted, so running this twice does not duplicate data.
 *
 * Vehicle photos are generated as local SVG files under the upload directory
 * rather than hot-linked, so the demo renders with no network access.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  AuctionStatus,
  BodyType,
  ConditionGrade,
  DealerStatus,
  Drivetrain,
  FuelType,
  InspectionSection,
  ListingStatus,
  PrismaClient,
  Province,
  SaleChannel,
  SectionRating,
  Transmission,
  UserRole,
  UserStatus,
  VehicleCondition,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Every demo account shares this password — local development only. */
const DEMO_PASSWORD = 'AtlasDemo123!';

const UPLOAD_DIR = resolve(process.env['UPLOAD_DIR'] ?? './uploads');
const SEED_IMAGE_DIR = join(UPLOAD_DIR, 'seed');

const PALETTE: Array<[string, string]> = [
  ['#0b1f3a', '#2f6fb5'],
  ['#1f1f24', '#5f6672'],
  ['#3d1f2e', '#a8607f'],
  ['#12352c', '#4fa37a'],
  ['#3a2f14', '#c9a227'],
  ['#241d3d', '#7a6bb8'],
];

function escapeXml(value: string): string {
  return value.replace(
    /[<>&'"]/g,
    (char) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char,
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Writes a placeholder photo and returns its public URL. */
function writePlaceholderImage(slug: string, label: string, index: number): string {
  const [from, to] = PALETTE[index % PALETTE.length]!;
  const filename = `${slug}-${index}.svg`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720" role="img" aria-label="${escapeXml(label)}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="960" height="720" fill="url(#g)"/>
  <text x="480" y="352" font-family="system-ui, sans-serif" font-size="38" font-weight="600"
        fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${escapeXml(label)}</text>
  <text x="480" y="402" font-family="system-ui, sans-serif" font-size="20"
        fill="#ffffff" fill-opacity="0.72" text-anchor="middle">Photo ${index + 1}</text>
</svg>`;
  writeFileSync(join(SEED_IMAGE_DIR, filename), svg, 'utf8');
  return `/uploads/seed/${filename}`;
}

interface SeedUser {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  phone?: string;
  province?: Province;
  city?: string;
  emailVerified?: boolean;
  dealer?: {
    name: string;
    status: DealerStatus;
    verified: boolean;
    businessNumber?: string;
    licenceNumber?: string;
    description?: string;
  };
}

const USERS: SeedUser[] = [
  {
    email: 'admin@atlas.test',
    firstName: 'Ada',
    lastName: 'Okonkwo',
    role: UserRole.SUPER_ADMIN,
    province: Province.ON,
    city: 'Toronto',
    emailVerified: true,
  },
  {
    email: 'moderator@atlas.test',
    firstName: 'Ben',
    lastName: 'Fortier',
    role: UserRole.ADMIN,
    province: Province.QC,
    city: 'Montreal',
    emailVerified: true,
  },
  {
    email: 'inspector@atlas.test',
    firstName: 'Rae',
    lastName: 'Nakamura',
    role: UserRole.INSPECTOR,
    province: Province.ON,
    city: 'Hamilton',
    emailVerified: true,
  },
  {
    email: 'sales@northshoremotors.test',
    firstName: 'Nina',
    lastName: 'Petrov',
    role: UserRole.DEALER,
    phone: '604-555-0142',
    province: Province.BC,
    city: 'North Vancouver',
    emailVerified: true,
    dealer: {
      name: 'North Shore Motors',
      status: DealerStatus.VERIFIED,
      verified: true,
      businessNumber: '812345678RC0001',
      licenceNumber: 'BC-DL-44821',
      description:
        'Family-run dealership on the North Shore since 1998, specialising in low-kilometre imports and certified pre-owned SUVs.',
    },
  },
  {
    email: 'team@prairieautogroup.test',
    firstName: 'Cole',
    lastName: 'Whitecalf',
    role: UserRole.DEALER,
    phone: '403-555-0188',
    province: Province.AB,
    city: 'Calgary',
    emailVerified: true,
    dealer: {
      name: 'Prairie Auto Group',
      status: DealerStatus.VERIFIED,
      verified: true,
      businessNumber: '798765432RC0001',
      licenceNumber: 'AB-DL-10932',
      description:
        'Alberta’s volume dealer for trucks and electric vehicles, with in-house financing and province-wide delivery.',
    },
  },
  {
    email: 'contact@maplecityauto.test',
    firstName: 'Priya',
    lastName: 'Raman',
    role: UserRole.DEALER,
    phone: '519-555-0170',
    province: Province.ON,
    city: 'London',
    emailVerified: true,
    dealer: {
      name: 'Maple City Auto',
      status: DealerStatus.PENDING,
      verified: false,
      businessNumber: '741852963RC0001',
      description: 'Independent used-car dealer serving southwestern Ontario.',
    },
  },
  {
    email: 'marc.tremblay@example.test',
    firstName: 'Marc',
    lastName: 'Tremblay',
    role: UserRole.SELLER,
    phone: '514-555-0133',
    province: Province.QC,
    city: 'Laval',
    emailVerified: true,
  },
  {
    email: 'sofia.martins@example.test',
    firstName: 'Sofia',
    lastName: 'Martins',
    role: UserRole.SELLER,
    phone: '416-555-0119',
    province: Province.ON,
    city: 'Mississauga',
    emailVerified: true,
  },
  {
    email: 'jordan.lee@example.test',
    firstName: 'Jordan',
    lastName: 'Lee',
    role: UserRole.BUYER,
    province: Province.BC,
    city: 'Burnaby',
    emailVerified: true,
  },
  {
    email: 'sam.okafor@example.test',
    firstName: 'Sam',
    lastName: 'Okafor',
    role: UserRole.BUYER,
    province: Province.ON,
    city: 'Ottawa',
    emailVerified: true,
  },
  {
    email: 'unverified.buyer@example.test',
    firstName: 'Tomas',
    lastName: 'Silva',
    role: UserRole.BUYER,
    province: Province.MB,
    city: 'Winnipeg',
    emailVerified: false,
  },
];

interface SeedVehicle {
  sellerEmail: string;
  make: string;
  model: string;
  trim?: string;
  year: number;
  priceCad: number;
  reservePriceCad?: number;
  mileageKm: number;
  condition: VehicleCondition;
  bodyType: BodyType;
  transmission: Transmission;
  fuelType: FuelType;
  drivetrain: Drivetrain;
  engine?: string;
  engineSizeL?: number;
  cylinders?: number;
  doors?: number;
  seats?: number;
  exteriorColour: string;
  interiorColour?: string;
  vin: string;
  province: Province;
  city: string;
  status?: ListingStatus;
  saleChannel?: SaleChannel;
  features?: string[];
  description: string;
  imageCount?: number;
}

const VEHICLES: SeedVehicle[] = [
  {
    sellerEmail: 'sales@northshoremotors.test',
    make: 'Toyota',
    model: 'RAV4',
    trim: 'XLE AWD',
    year: 2022,
    priceCad: 38900,
    mileageKm: 41200,
    condition: VehicleCondition.CERTIFIED_PRE_OWNED,
    bodyType: BodyType.SUV,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.AWD,
    engine: '2.5L I4',
    engineSizeL: 2.5,
    cylinders: 4,
    doors: 4,
    seats: 5,
    exteriorColour: 'Silver Sky Metallic',
    interiorColour: 'Black',
    vin: '2T3W1RFV8NW123456',
    province: Province.BC,
    city: 'North Vancouver',
    features: ['Sunroof', 'Heated seats', 'Apple CarPlay', 'Blind-spot monitoring', 'Backup camera'],
    imageCount: 3,
    description:
      'One-owner RAV4 XLE with all-wheel drive, sunroof and heated seats. Certified pre-owned with a 160-point inspection completed in June. Clean history report, no accidents, service records available on request. Winter tires on steel rims included.',
  },
  {
    sellerEmail: 'sales@northshoremotors.test',
    make: 'Honda',
    model: 'Civic',
    trim: 'Sport Hatchback',
    year: 2023,
    priceCad: 31500,
    mileageKm: 18700,
    condition: VehicleCondition.USED,
    bodyType: BodyType.HATCHBACK,
    transmission: Transmission.CVT,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.FWD,
    engine: '2.0L I4',
    engineSizeL: 2.0,
    cylinders: 4,
    doors: 4,
    seats: 5,
    exteriorColour: 'Rallye Red',
    vin: 'SHHFL2H85PU234567',
    province: Province.BC,
    city: 'North Vancouver',
    features: ['Wireless charging', 'Apple CarPlay', 'Remote start', 'Lane keep assist'],
    imageCount: 2,
    description:
      'Low-kilometre Civic Sport hatchback still under factory warranty. Apple CarPlay, wireless charging, blind-spot monitoring and remote start. Never smoked in, always garage kept. Balance of powertrain coverage transfers to the new owner.',
  },
  {
    sellerEmail: 'sales@northshoremotors.test',
    make: 'Ford',
    model: 'F-150',
    trim: 'Lariat SuperCrew',
    year: 2021,
    priceCad: 54750,
    reservePriceCad: 49000,
    mileageKm: 78400,
    condition: VehicleCondition.USED,
    bodyType: BodyType.TRUCK,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.FOUR_WHEEL_DRIVE,
    engine: '3.5L EcoBoost V6',
    engineSizeL: 3.5,
    cylinders: 6,
    doors: 4,
    seats: 5,
    exteriorColour: 'Agate Black',
    interiorColour: 'Black leather',
    vin: '1FTFW1E85MFA34567',
    province: Province.BC,
    city: 'North Vancouver',
    status: ListingStatus.ACTIVE,
    saleChannel: SaleChannel.AUCTION,
    features: ['Tow package', 'Panoramic roof', '360-degree camera', 'Spray-in bedliner'],
    imageCount: 3,
    description:
      'Well-equipped F-150 Lariat with the 3.5L EcoBoost, tow package and spray-in bedliner. Leather seating, panoramic roof and 360-degree camera. Recent brake service and fresh oil change. Ready to work or tow the trailer this summer.',
  },
  {
    sellerEmail: 'team@prairieautogroup.test',
    make: 'Tesla',
    model: 'Model 3',
    trim: 'Long Range AWD',
    year: 2023,
    priceCad: 47900,
    reservePriceCad: 44000,
    mileageKm: 29800,
    condition: VehicleCondition.USED,
    bodyType: BodyType.SEDAN,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.ELECTRIC,
    drivetrain: Drivetrain.AWD,
    doors: 4,
    seats: 5,
    exteriorColour: 'Pearl White',
    interiorColour: 'Black',
    vin: '5YJ3E1EB8PF345678',
    province: Province.AB,
    city: 'Calgary',
    saleChannel: SaleChannel.AUCTION,
    features: ['Autopilot', 'Premium audio', 'Heated rear seats', 'Glass roof'],
    imageCount: 3,
    description:
      'Long Range Model 3 with an estimated 500 km of range. Full self-driving computer, premium interior audio and heated rear seats. Battery health report available. Includes mobile connector and a set of all-season tires with 80% tread.',
  },
  {
    sellerEmail: 'team@prairieautogroup.test',
    make: 'Subaru',
    model: 'Outback',
    trim: 'Touring',
    year: 2020,
    priceCad: 32400,
    mileageKm: 96500,
    condition: VehicleCondition.USED,
    bodyType: BodyType.WAGON,
    transmission: Transmission.CVT,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.AWD,
    engine: '2.5L Boxer H4',
    engineSizeL: 2.5,
    cylinders: 4,
    exteriorColour: 'Crystal Black Silica',
    vin: '4S4BTANC5L3456789',
    province: Province.AB,
    city: 'Calgary',
    features: ['EyeSight driver assist', 'Dual sunroofs', 'Power tailgate', 'Leather'],
    imageCount: 2,
    description:
      'Outback Touring with symmetrical all-wheel drive and EyeSight driver assistance. Leather, dual sunroofs and a power tailgate. Highway kilometres, timing belt and water pump done at 90,000 km. Excellent winter vehicle for the Prairies.',
  },
  {
    sellerEmail: 'team@prairieautogroup.test',
    make: 'Ram',
    model: '1500',
    trim: 'Big Horn Crew Cab',
    year: 2019,
    priceCad: 36800,
    mileageKm: 128900,
    condition: VehicleCondition.USED,
    bodyType: BodyType.TRUCK,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.FOUR_WHEEL_DRIVE,
    engine: '5.7L HEMI V8',
    engineSizeL: 5.7,
    cylinders: 8,
    exteriorColour: 'Bright White',
    vin: '1C6SRFFT6KN456789',
    province: Province.AB,
    city: 'Red Deer',
    features: ['Heated steering wheel', 'Tonneau cover', 'Running boards'],
    imageCount: 2,
    description:
      'Big Horn crew cab with the 5.7L HEMI and 8-speed automatic. Heated seats and steering wheel, backup camera, tonneau cover and running boards. Used as a family truck rather than a work truck. Highway kilometres with full service history.',
  },
  {
    sellerEmail: 'team@prairieautogroup.test',
    make: 'Hyundai',
    model: 'Kona Electric',
    trim: 'Preferred',
    year: 2024,
    priceCad: 42500,
    mileageKm: 9200,
    condition: VehicleCondition.NEW,
    bodyType: BodyType.SUV,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.ELECTRIC,
    drivetrain: Drivetrain.FWD,
    exteriorColour: 'Atlas White',
    vin: 'KM8K33AG5RU567890',
    province: Province.AB,
    city: 'Calgary',
    features: ['Heat pump', 'Level 2 charging', 'Adaptive cruise'],
    imageCount: 2,
    description:
      'Demonstrator Kona Electric with the full factory warranty intact. Roughly 420 km of range, heat pump for cold-weather efficiency, and Level 2 charging at up to 11 kW. Eligible for provincial and federal incentives where applicable.',
  },
  {
    sellerEmail: 'contact@maplecityauto.test',
    make: 'Mazda',
    model: 'CX-5',
    trim: 'GS Comfort',
    year: 2021,
    priceCad: 33200,
    mileageKm: 62300,
    condition: VehicleCondition.CERTIFIED_PRE_OWNED,
    bodyType: BodyType.SUV,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.AWD,
    engine: '2.5L I4',
    engineSizeL: 2.5,
    exteriorColour: 'Machine Grey',
    vin: 'JM3KFBCM6M0678901',
    province: Province.ON,
    city: 'London',
    features: ['Leatherette', 'Power liftgate', 'Moonroof'],
    imageCount: 3,
    description:
      'CX-5 GS Comfort package with leatherette seating, power liftgate and moonroof. Certified pre-owned with fresh brakes and a new set of all-season tires. Two sets of keys, owner manuals and complete dealer service history included.',
  },
  {
    sellerEmail: 'contact@maplecityauto.test',
    make: 'Volkswagen',
    model: 'Golf GTI',
    trim: 'Autobahn',
    year: 2022,
    priceCad: 36900,
    mileageKm: 34100,
    condition: VehicleCondition.USED,
    bodyType: BodyType.HATCHBACK,
    transmission: Transmission.DUAL_CLUTCH,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.FWD,
    engine: '2.0L TSI I4',
    engineSizeL: 2.0,
    exteriorColour: 'Moonstone Grey',
    vin: 'WVWTA7CD8NW789012',
    province: Province.ON,
    city: 'London',
    features: ['Adaptive damping', 'Harman Kardon audio', 'Heated seats'],
    imageCount: 2,
    description:
      'GTI Autobahn with the 7-speed DSG, adaptive damping and Harman Kardon audio. Enthusiast owned and completely stock. Recent DSG service and new front tires. Summer and winter wheel packages both available with the car.',
  },
  {
    sellerEmail: 'contact@maplecityauto.test',
    make: 'Chevrolet',
    model: 'Equinox',
    trim: 'LT AWD',
    year: 2020,
    priceCad: 24900,
    mileageKm: 104700,
    condition: VehicleCondition.USED,
    bodyType: BodyType.SUV,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.AWD,
    exteriorColour: 'Summit White',
    vin: '2GNAXUEV8L6890123',
    province: Province.ON,
    city: 'Kitchener',
    status: ListingStatus.PENDING_REVIEW,
    features: ['Remote start', 'Heated front seats', 'Apple CarPlay'],
    imageCount: 2,
    description:
      'Practical Equinox LT with all-wheel drive and remote start. Heated front seats, Apple CarPlay and a roomy cargo area. Serviced regularly, new battery last fall. A sensible commuter that handles Ontario winters without drama.',
  },
  {
    sellerEmail: 'contact@maplecityauto.test',
    make: 'BMW',
    model: '330i',
    trim: 'xDrive M Sport',
    year: 2021,
    priceCad: 44200,
    mileageKm: 58900,
    condition: VehicleCondition.USED,
    bodyType: BodyType.SEDAN,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.AWD,
    engine: '2.0L TwinPower I4',
    engineSizeL: 2.0,
    exteriorColour: 'Portimao Blue',
    interiorColour: 'Cognac leather',
    vin: '3MW5R7J09M8901234',
    province: Province.ON,
    city: 'London',
    features: ['M Sport package', 'Adaptive suspension', 'Wireless CarPlay'],
    imageCount: 3,
    description:
      '330i xDrive with the M Sport package, adaptive suspension and Harman Kardon sound. Full leather, heated steering wheel and wireless CarPlay. Just serviced with new brake pads and rotors front and rear. Accident free.',
  },
  {
    sellerEmail: 'sofia.martins@example.test',
    make: 'Honda',
    model: 'CR-V',
    trim: 'EX-L',
    year: 2018,
    priceCad: 26500,
    mileageKm: 132400,
    condition: VehicleCondition.USED,
    bodyType: BodyType.SUV,
    transmission: Transmission.CVT,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.AWD,
    exteriorColour: 'Lunar Silver',
    vin: '2HKRW2H85JH901234',
    province: Province.ON,
    city: 'Mississauga',
    features: ['Leather', 'Sunroof', 'Adaptive cruise'],
    imageCount: 2,
    description:
      'Selling our family CR-V EX-L as we have downsized to one vehicle. Leather, sunroof, heated seats and adaptive cruise. All maintenance done at the dealer and I have every receipt. New all-season tires last spring. Non-smoking household, no pets.',
  },
  {
    sellerEmail: 'sofia.martins@example.test',
    make: 'Toyota',
    model: 'Corolla',
    trim: 'LE',
    year: 2017,
    priceCad: 16800,
    mileageKm: 148600,
    condition: VehicleCondition.USED,
    bodyType: BodyType.SEDAN,
    transmission: Transmission.CVT,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.FWD,
    exteriorColour: 'Classic Silver',
    vin: '2T1BURHE8HC012345',
    province: Province.ON,
    city: 'Mississauga',
    features: ['Backup camera', 'Heated seats', 'Bluetooth'],
    imageCount: 2,
    description:
      'Reliable Corolla LE that has been a great commuter car. Backup camera, heated seats and Bluetooth. Recent safety certification completed, new front brakes and battery. Some minor stone chips on the hood, otherwise very clean inside and out.',
  },
  {
    sellerEmail: 'marc.tremblay@example.test',
    make: 'Jeep',
    model: 'Wrangler',
    trim: 'Rubicon Unlimited',
    year: 2019,
    priceCad: 45900,
    mileageKm: 87300,
    condition: VehicleCondition.USED,
    bodyType: BodyType.SUV,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.FOUR_WHEEL_DRIVE,
    engine: '3.6L Pentastar V6',
    engineSizeL: 3.6,
    cylinders: 6,
    exteriorColour: 'Firecracker Red',
    vin: '1C4HJXFG8KW123456',
    province: Province.QC,
    city: 'Laval',
    features: ['Locking differentials', 'Removable hard top', '33-inch tires'],
    imageCount: 3,
    description:
      'Wrangler Rubicon Unlimited with lockers, disconnecting sway bar and 33-inch tires. Hard top and soft top both included. Never off-roaded hard, mostly used for camping trips. Rust-proofed every year since new, which matters on Quebec roads.',
  },
  {
    sellerEmail: 'marc.tremblay@example.test',
    make: 'Nissan',
    model: 'Leaf',
    trim: 'SV Plus',
    year: 2021,
    priceCad: 27800,
    mileageKm: 54600,
    condition: VehicleCondition.USED,
    bodyType: BodyType.HATCHBACK,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.ELECTRIC,
    drivetrain: Drivetrain.FWD,
    exteriorColour: 'Gun Metallic',
    vin: '1N4BZ1CV5MC345678',
    province: Province.QC,
    city: 'Laval',
    features: ['ProPILOT assist', 'Heated steering wheel', '62 kWh battery'],
    imageCount: 2,
    description:
      'Leaf SV Plus with the 62 kWh battery, roughly 350 km of real-world range in summer. ProPILOT assist, heated seats and steering wheel. Twelve of twelve battery health bars. Charges overnight on a standard Level 2 home charger.',
  },
  {
    sellerEmail: 'marc.tremblay@example.test',
    make: 'Audi',
    model: 'Q5',
    trim: 'Progressiv quattro',
    year: 2020,
    priceCad: 38600,
    mileageKm: 89700,
    condition: VehicleCondition.USED,
    bodyType: BodyType.SUV,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.AWD,
    exteriorColour: 'Navarra Blue',
    vin: 'WA1BNAFY8L2890123',
    province: Province.QC,
    city: 'Montreal',
    status: ListingStatus.DRAFT,
    features: ['Virtual cockpit', 'Panoramic roof'],
    imageCount: 1,
    description:
      'Q5 Progressiv with quattro all-wheel drive, virtual cockpit and panoramic roof. Still finishing the detail and gathering service records before publishing, so this listing is a work in progress and not yet live on the marketplace.',
  },
  {
    sellerEmail: 'sales@northshoremotors.test',
    make: 'Toyota',
    model: 'Sienna',
    trim: 'XSE Hybrid AWD',
    year: 2023,
    priceCad: 56400,
    mileageKm: 27400,
    condition: VehicleCondition.CERTIFIED_PRE_OWNED,
    bodyType: BodyType.MINIVAN,
    transmission: Transmission.CVT,
    fuelType: FuelType.HYBRID,
    drivetrain: Drivetrain.AWD,
    seats: 7,
    exteriorColour: 'Predawn Grey Mica',
    vin: '5TDZRKEC8PS456789',
    province: Province.BC,
    city: 'Burnaby',
    features: ['Captain chairs', 'Power sliding doors', 'Built-in vacuum'],
    imageCount: 3,
    description:
      'Sienna XSE hybrid with all-wheel drive and captain chairs. Real-world fuel economy around 6.5 L/100 km, which is remarkable for a van this size. Power sliding doors, rear entertainment and a built-in vacuum. Certified with a fresh inspection.',
  },
  {
    sellerEmail: 'team@prairieautogroup.test',
    make: 'Ford',
    model: 'Mustang',
    trim: 'GT Premium',
    year: 2018,
    priceCad: 41500,
    mileageKm: 63800,
    condition: VehicleCondition.USED,
    bodyType: BodyType.COUPE,
    transmission: Transmission.MANUAL,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.RWD,
    engine: '5.0L Coyote V8',
    engineSizeL: 5.0,
    cylinders: 8,
    exteriorColour: 'Race Red',
    vin: '1FA6P8CF5J5567890',
    province: Province.AB,
    city: 'Calgary',
    features: ['Active exhaust', 'Recaro seats', 'Adaptive dampers'],
    imageCount: 3,
    description:
      'Mustang GT Premium with the 5.0L Coyote V8 and a six-speed manual. Active exhaust, Recaro seats and adaptive dampers. Stored every winter and driven only on dry days, so the underside is clean. Adult owned and never tracked.',
  },
  {
    sellerEmail: 'contact@maplecityauto.test',
    make: 'Kia',
    model: 'Sorento',
    trim: 'EX+ AWD',
    year: 2022,
    priceCad: 39800,
    mileageKm: 45900,
    condition: VehicleCondition.USED,
    bodyType: BodyType.SUV,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.AWD,
    seats: 7,
    exteriorColour: 'Gravity Grey',
    vin: '5XYRH4JF6NG678901',
    province: Province.ON,
    city: 'London',
    features: ['Third row', 'Turbo four-cylinder', 'Wireless charging'],
    imageCount: 2,
    description:
      'Three-row Sorento EX+ with all-wheel drive and the turbo four-cylinder. Seats seven with the third row up and still has usable cargo space. Balance of the five-year comprehensive warranty remains. Great family hauler at a sensible price.',
  },
  {
    sellerEmail: 'sofia.martins@example.test',
    make: 'Mazda',
    model: 'Mazda3',
    trim: 'GS Sport',
    year: 2019,
    priceCad: 19900,
    mileageKm: 118500,
    condition: VehicleCondition.USED,
    bodyType: BodyType.SEDAN,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.FWD,
    exteriorColour: 'Soul Red Crystal',
    vin: '3MZBPABL8KM789012',
    province: Province.ON,
    city: 'Mississauga',
    status: ListingStatus.SOLD,
    features: ['Heated seats', 'Blind-spot monitoring'],
    imageCount: 2,
    description:
      'Mazda3 GS Sport in Soul Red. Heated seats, blind-spot monitoring and a very well put together interior for the price. Regular oil changes every 8,000 km. Now sold, kept visible as an example of a completed private sale.',
  },
];

async function main(): Promise<void> {
  mkdirSync(SEED_IMAGE_DIR, { recursive: true });

  console.log('Seeding users and dealers...');
  const usersByEmail = new Map<string, { id: string }>();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const seedUser of USERS) {
    const user = await prisma.user.upsert({
      where: { email: seedUser.email },
      update: {
        firstName: seedUser.firstName,
        lastName: seedUser.lastName,
        role: seedUser.role,
        status: UserStatus.ACTIVE,
        emailVerified: seedUser.emailVerified ?? false,
        emailVerifiedAt: seedUser.emailVerified ? new Date() : null,
        phone: seedUser.phone ?? null,
        province: seedUser.province ?? null,
        city: seedUser.city ?? null,
      },
      create: {
        email: seedUser.email,
        passwordHash,
        firstName: seedUser.firstName,
        lastName: seedUser.lastName,
        role: seedUser.role,
        status: UserStatus.ACTIVE,
        emailVerified: seedUser.emailVerified ?? false,
        emailVerifiedAt: seedUser.emailVerified ? new Date() : null,
        phone: seedUser.phone ?? null,
        province: seedUser.province ?? null,
        city: seedUser.city ?? null,
      },
      select: { id: true },
    });
    usersByEmail.set(seedUser.email, user);

    if (seedUser.dealer) {
      await prisma.dealer.upsert({
        where: { ownerId: user.id },
        update: {
          name: seedUser.dealer.name,
          status: seedUser.dealer.status,
          verified: seedUser.dealer.verified,
          verifiedAt: seedUser.dealer.verified ? new Date() : null,
          businessNumber: seedUser.dealer.businessNumber ?? null,
          licenceNumber: seedUser.dealer.licenceNumber ?? null,
          description: seedUser.dealer.description ?? null,
          province: seedUser.province ?? null,
          city: seedUser.city ?? null,
        },
        create: {
          ownerId: user.id,
          name: seedUser.dealer.name,
          slug: slugify(seedUser.dealer.name),
          status: seedUser.dealer.status,
          verified: seedUser.dealer.verified,
          verifiedAt: seedUser.dealer.verified ? new Date() : null,
          businessNumber: seedUser.dealer.businessNumber ?? null,
          licenceNumber: seedUser.dealer.licenceNumber ?? null,
          description: seedUser.dealer.description ?? null,
          province: seedUser.province ?? null,
          city: seedUser.city ?? null,
        },
      });
    }
  }

  console.log('Seeding vehicles...');
  const vehicleIds: string[] = [];

  for (const [index, seed] of VEHICLES.entries()) {
    const seller = usersByEmail.get(seed.sellerEmail);
    if (!seller) throw new Error(`Unknown seller email: ${seed.sellerEmail}`);

    const status = seed.status ?? ListingStatus.ACTIVE;
    const title = `${seed.year} ${seed.make} ${seed.model}${seed.trim ? ` ${seed.trim}` : ''}`;
    const slug = slugify(`${title}-${seed.vin.slice(-6)}`);

    // Stagger publish dates so "newest first" produces a believable ordering.
    const publishedAt =
      status === ListingStatus.ACTIVE || status === ListingStatus.SOLD
        ? new Date(Date.now() - index * 36 * 60 * 60 * 1000)
        : null;

    const existing = await prisma.vehicle.findFirst({
      where: { vin: seed.vin },
      select: { id: true },
    });

    const data = {
      sellerId: seller.id,
      slug,
      title,
      description: seed.description,
      vin: seed.vin,
      make: seed.make,
      model: seed.model,
      trim: seed.trim ?? null,
      year: seed.year,
      priceCad: seed.priceCad,
      reservePriceCad: seed.reservePriceCad ?? null,
      mileageKm: seed.mileageKm,
      condition: seed.condition,
      bodyType: seed.bodyType,
      transmission: seed.transmission,
      fuelType: seed.fuelType,
      drivetrain: seed.drivetrain,
      engine: seed.engine ?? null,
      engineSizeL: seed.engineSizeL ?? null,
      cylinders: seed.cylinders ?? null,
      doors: seed.doors ?? null,
      seats: seed.seats ?? null,
      exteriorColour: seed.exteriorColour,
      interiorColour: seed.interiorColour ?? null,
      province: seed.province,
      city: seed.city,
      status,
      saleChannel: seed.saleChannel ?? SaleChannel.FIXED_PRICE,
      features: seed.features ?? [],
      publishedAt,
      soldAt: status === ListingStatus.SOLD ? new Date() : null,
      viewCount: status === ListingStatus.ACTIVE ? 40 + index * 17 : 0,
    };

    const vehicle = existing
      ? await prisma.vehicle.update({ where: { id: existing.id }, data, select: { id: true } })
      : await prisma.vehicle.create({ data, select: { id: true } });

    vehicleIds.push(vehicle.id);

    // Images are regenerated wholesale so re-seeding never accumulates copies.
    await prisma.vehicleImage.deleteMany({ where: { vehicleId: vehicle.id } });
    const imageSlug = slugify(`${seed.year}-${seed.make}-${seed.model}`);
    await prisma.vehicleImage.createMany({
      data: Array.from({ length: seed.imageCount ?? 2 }, (_, position) => ({
        vehicleId: vehicle.id,
        url: writePlaceholderImage(imageSlug, title, position),
        alt: `${title} photo ${position + 1}`,
        position,
      })),
    });
  }

  console.log('Seeding inspections...');
  const inspector = usersByEmail.get('inspector@atlas.test')!;
  const inspectedVehicleIds = [vehicleIds[0]!, vehicleIds[3]!, vehicleIds[7]!];

  for (const [index, vehicleId] of inspectedVehicleIds.entries()) {
    const existing = await prisma.vehicleInspection.findFirst({
      where: { vehicleId },
      select: { id: true },
    });

    const inspection = existing
      ? await prisma.vehicleInspection.update({
          where: { id: existing.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
          select: { id: true },
        })
      : await prisma.vehicleInspection.create({
          data: {
            vehicleId,
            inspectorId: inspector.id,
            status: 'COMPLETED',
            overallGrade: [ConditionGrade.GRADE_4, ConditionGrade.GRADE_5, ConditionGrade.GRADE_3][
              index
            ]!,
            summary:
              'Vehicle inspected on a hoist over approximately 90 minutes. Road test completed. Findings below reflect condition at the time of inspection.',
            odometerReadingKm: 40000 + index * 12000,
            hasFrameDamage: false,
            hasAccidentHistory: index === 2,
            estimatedReconditioningCad: index === 2 ? 1800 : 350,
            completedAt: new Date(),
          },
          select: { id: true },
        });

    await prisma.inspectionSectionResult.deleteMany({ where: { inspectionId: inspection.id } });
    await prisma.inspectionSectionResult.createMany({
      data: [
        { section: InspectionSection.EXTERIOR, rating: SectionRating.GOOD, notes: 'Minor stone chips on the front bumper.' },
        { section: InspectionSection.INTERIOR, rating: SectionRating.EXCELLENT, notes: null },
        { section: InspectionSection.ENGINE, rating: SectionRating.EXCELLENT, notes: 'No leaks or abnormal noise.' },
        { section: InspectionSection.TRANSMISSION, rating: SectionRating.GOOD, notes: null },
        { section: InspectionSection.BRAKES, rating: index === 2 ? SectionRating.FAIR : SectionRating.GOOD, notes: index === 2 ? 'Front pads at approximately 30%.' : null },
        { section: InspectionSection.SUSPENSION, rating: SectionRating.GOOD, notes: null },
        { section: InspectionSection.ELECTRICAL, rating: SectionRating.EXCELLENT, notes: null },
        { section: InspectionSection.TIRES, rating: SectionRating.GOOD, notes: 'All-season tires with even wear.' },
        { section: InspectionSection.FRAME, rating: SectionRating.EXCELLENT, notes: 'No evidence of structural repair.' },
        { section: InspectionSection.ROAD_TEST, rating: SectionRating.EXCELLENT, notes: 'Tracks straight, no vibration at highway speed.' },
      ].map((section) => ({ ...section, inspectionId: inspection.id })),
    });
  }

  console.log('Seeding auctions and bids...');
  const buyerJordan = usersByEmail.get('jordan.lee@example.test')!;
  const buyerSam = usersByEmail.get('sam.okafor@example.test')!;

  // Two live auctions with staggered close times, plus one already ended.
  const auctionSeeds = [
    { vehicleIndex: 2, startingBidCad: 42000, reservePriceCad: 49000, endsInHours: 6, bids: [43000, 44500, 46000] },
    { vehicleIndex: 3, startingBidCad: 40000, reservePriceCad: 44000, endsInHours: 26, bids: [41000, 42500] },
  ];

  for (const seed of auctionSeeds) {
    const vehicleId = vehicleIds[seed.vehicleIndex]!;
    const existing = await prisma.auction.findFirst({
      where: { vehicleId },
      select: { id: true },
    });
    if (existing) {
      await prisma.bid.deleteMany({ where: { auctionId: existing.id } });
      await prisma.auction.delete({ where: { id: existing.id } });
    }

    const vehicle = await prisma.vehicle.findUniqueOrThrow({
      where: { id: vehicleId },
      select: { title: true },
    });

    const endsAt = new Date(Date.now() + seed.endsInHours * 60 * 60 * 1000);
    const auction = await prisma.auction.create({
      data: {
        vehicleId,
        title: vehicle.title,
        status: AuctionStatus.LIVE,
        startingBidCad: seed.startingBidCad,
        currentBidCad: seed.bids[seed.bids.length - 1] ?? seed.startingBidCad,
        bidCount: seed.bids.length,
        reservePriceCad: seed.reservePriceCad,
        startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endsAt,
      },
      select: { id: true },
    });

    for (const [index, amount] of seed.bids.entries()) {
      const isLast = index === seed.bids.length - 1;
      await prisma.bid.create({
        data: {
          auctionId: auction.id,
          bidderId: index % 2 === 0 ? buyerJordan.id : buyerSam.id,
          amountCad: amount,
          status: isLast ? 'WINNING' : 'OUTBID',
          createdAt: new Date(Date.now() - (seed.bids.length - index) * 25 * 60 * 1000),
        },
      });
    }

    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { status: ListingStatus.IN_AUCTION, saleChannel: SaleChannel.AUCTION },
    });
  }

  console.log('Seeding favourites, conversations and notifications...');

  const favouritePairs = [
    { userId: buyerJordan.id, vehicleId: vehicleIds[0]! },
    { userId: buyerJordan.id, vehicleId: vehicleIds[3]! },
    { userId: buyerJordan.id, vehicleId: vehicleIds[16]! },
    { userId: buyerSam.id, vehicleId: vehicleIds[7]! },
    { userId: buyerSam.id, vehicleId: vehicleIds[11]! },
  ];
  for (const pair of favouritePairs) {
    await prisma.favourite.upsert({
      where: { userId_vehicleId: pair },
      update: {},
      create: pair,
    });
  }

  const threads = [
    {
      buyerId: buyerJordan.id,
      vehicleIndex: 0,
      messages: [
        { fromBuyer: true, body: 'Hi, is the RAV4 still available? I am interested in seeing it this weekend if so.' },
        { fromBuyer: false, body: 'Hello Jordan, yes it is still available. We are open Saturday from 9 to 5 — would 11am work for a test drive?' },
        { fromBuyer: true, body: 'Saturday at 11 works for me. Could you also send over the history report before then?' },
      ],
    },
    {
      buyerId: buyerSam.id,
      vehicleIndex: 11,
      messages: [
        { fromBuyer: true, body: 'Hi Sofia, I saw your CR-V listing. Has the timing belt or any major service been done recently?' },
        { fromBuyer: false, body: 'Hi Sam — the CR-V uses a timing chain so there is no belt to replace. It had a full brake service and new tires last spring, and I have all the receipts.' },
      ],
    },
  ];

  for (const thread of threads) {
    const vehicleId = vehicleIds[thread.vehicleIndex]!;
    const vehicle = await prisma.vehicle.findUniqueOrThrow({
      where: { id: vehicleId },
      select: { sellerId: true },
    });

    const conversation = await prisma.conversation.upsert({
      where: { vehicleId_buyerId: { vehicleId, buyerId: thread.buyerId } },
      update: {},
      create: { vehicleId, buyerId: thread.buyerId, sellerId: vehicle.sellerId },
      select: { id: true },
    });

    // Rewrite the thread so re-seeding produces the same conversation.
    await prisma.message.deleteMany({ where: { conversationId: conversation.id } });

    let lastMessageAt = new Date();
    for (const [index, message] of thread.messages.entries()) {
      lastMessageAt = new Date(Date.now() - (thread.messages.length - index) * 5 * 60 * 60 * 1000);
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: message.fromBuyer ? thread.buyerId : vehicle.sellerId,
          body: message.body,
          // Everything except the final message is marked read.
          readAt: index < thread.messages.length - 1 ? lastMessageAt : null,
          createdAt: lastMessageAt,
        },
      });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt },
    });
  }

  await prisma.notification.deleteMany({ where: { userId: buyerJordan.id } });
  await prisma.notification.createMany({
    data: [
      {
        userId: buyerJordan.id,
        type: 'OUTBID',
        title: 'You have been outbid on 2023 Tesla Model 3 Long Range AWD',
        body: 'The current bid is now $42,500.',
        link: '/auctions',
      },
      {
        userId: buyerJordan.id,
        type: 'AUCTION_ENDING',
        title: '2021 Ford F-150 Lariat SuperCrew closes in 6 hours',
        body: 'You are the current high bidder.',
        link: '/auctions',
      },
    ],
  });

  const counts = {
    users: await prisma.user.count(),
    dealers: await prisma.dealer.count(),
    vehicles: await prisma.vehicle.count(),
    images: await prisma.vehicleImage.count(),
    inspections: await prisma.vehicleInspection.count(),
    auctions: await prisma.auction.count(),
    bids: await prisma.bid.count(),
    favourites: await prisma.favourite.count(),
    conversations: await prisma.conversation.count(),
    messages: await prisma.message.count(),
    notifications: await prisma.notification.count(),
  };

  console.log('\nSeed complete:');
  for (const [label, value] of Object.entries(counts)) {
    console.log(`  ${label.padEnd(16)} ${value}`);
  }
  console.log(`\nAll demo accounts use the password: ${DEMO_PASSWORD}`);
  console.log('  admin@atlas.test                 super admin');
  console.log('  moderator@atlas.test             admin');
  console.log('  inspector@atlas.test             inspector');
  console.log('  sales@northshoremotors.test      dealer (verified)');
  console.log('  contact@maplecityauto.test       dealer (pending verification)');
  console.log('  marc.tremblay@example.test       private seller');
  console.log('  jordan.lee@example.test          buyer');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
