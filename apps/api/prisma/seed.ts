/**
 * Seeds a realistic Canadian demo marketplace.
 *
 * Safe to re-run: everything is keyed by a natural identifier (user email,
 * listing VIN) and upserted, so running this twice does not duplicate data.
 *
 * Listing photos are generated as local SVG files under the API's upload
 * directory rather than hot-linked, so the demo renders with no network access.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  BodyType,
  Drivetrain,
  FuelType,
  ListingStatus,
  PrismaClient,
  Province,
  Transmission,
  UserRole,
  VehicleCondition,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Every demo account shares this password — local development only. */
const DEMO_PASSWORD = 'AtlasDemo123!';

const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR ?? './uploads');
const SEED_IMAGE_DIR = join(UPLOAD_DIR, 'seed');

const PALETTE: Array<[string, string]> = [
  ['#1e3a5f', '#4a90d9'],
  ['#2d2d2d', '#6e6e6e'],
  ['#5a2a3d', '#c4708f'],
  ['#1f4037', '#68b984'],
  ['#4a3520', '#c9a227'],
  ['#33254d', '#8b7bc4'],
];

/**
 * Writes a placeholder photo for a listing and returns its public URL.
 * The gradient is derived from the index so the same listing always looks the same.
 */
function writePlaceholderImage(slug: string, label: string, index: number): string {
  const [from, to] = PALETTE[index % PALETTE.length]!;
  const filename = `${slug}-${index}.svg`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600" role="img" aria-label="${escapeXml(label)}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#g)"/>
  <text x="400" y="300" font-family="system-ui, sans-serif" font-size="34" font-weight="600"
        fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${escapeXml(label)}</text>
  <text x="400" y="345" font-family="system-ui, sans-serif" font-size="18"
        fill="#ffffff" fill-opacity="0.75" text-anchor="middle">Photo ${index + 1}</text>
</svg>`;
  writeFileSync(join(SEED_IMAGE_DIR, filename), svg, 'utf8');
  return `/uploads/seed/${filename}`;
}

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

interface SeedUser {
  email: string;
  displayName: string;
  role: UserRole;
  phone?: string;
  province?: Province;
  city?: string;
  dealershipName?: string;
  dealershipVerified?: boolean;
}

const USERS: SeedUser[] = [
  {
    email: 'admin@atlas.test',
    displayName: 'Atlas Admin',
    role: UserRole.ADMIN,
    province: Province.ON,
    city: 'Toronto',
  },
  {
    email: 'sales@northshoremotors.test',
    displayName: 'North Shore Motors',
    role: UserRole.DEALER,
    phone: '604-555-0142',
    province: Province.BC,
    city: 'North Vancouver',
    dealershipName: 'North Shore Motors',
    dealershipVerified: true,
  },
  {
    email: 'team@prairieautogroup.test',
    displayName: 'Prairie Auto Group',
    role: UserRole.DEALER,
    phone: '403-555-0188',
    province: Province.AB,
    city: 'Calgary',
    dealershipName: 'Prairie Auto Group',
    dealershipVerified: true,
  },
  {
    email: 'contact@maplecityauto.test',
    displayName: 'Maple City Auto',
    role: UserRole.DEALER,
    phone: '519-555-0170',
    province: Province.ON,
    city: 'London',
    dealershipName: 'Maple City Auto',
    dealershipVerified: false,
  },
  {
    email: 'priya.raman@example.test',
    displayName: 'Priya Raman',
    role: UserRole.PRIVATE_SELLER,
    phone: '416-555-0119',
    province: Province.ON,
    city: 'Mississauga',
  },
  {
    email: 'marc.tremblay@example.test',
    displayName: 'Marc Tremblay',
    role: UserRole.PRIVATE_SELLER,
    phone: '514-555-0133',
    province: Province.QC,
    city: 'Laval',
  },
  {
    email: 'jordan.lee@example.test',
    displayName: 'Jordan Lee',
    role: UserRole.BUYER,
    province: Province.BC,
    city: 'Burnaby',
  },
  {
    email: 'sam.okafor@example.test',
    displayName: 'Sam Okafor',
    role: UserRole.BUYER,
    province: Province.ON,
    city: 'Ottawa',
  },
];

interface SeedListing {
  sellerEmail: string;
  make: string;
  model: string;
  trim?: string;
  year: number;
  priceCad: number;
  mileageKm: number;
  condition: VehicleCondition;
  bodyType: BodyType;
  transmission: Transmission;
  fuelType: FuelType;
  drivetrain: Drivetrain;
  exteriorColour: string;
  vin: string;
  province: Province;
  city: string;
  status?: ListingStatus;
  description: string;
  imageCount?: number;
}

const LISTINGS: SeedListing[] = [
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
    exteriorColour: 'Silver Sky Metallic',
    vin: '2T3W1RFV8NW123456',
    province: Province.BC,
    city: 'North Vancouver',
    imageCount: 3,
    description:
      'One-owner RAV4 XLE with all-wheel drive, sunroof and heated seats. Certified pre-owned with a 160-point inspection completed in June. Clean CarFax, no accidents, service records available on request. Winter tires on steel rims included.',
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
    exteriorColour: 'Rallye Red',
    vin: 'SHHFL2H85PU234567',
    province: Province.BC,
    city: 'North Vancouver',
    imageCount: 2,
    description:
      'Low-kilometre Civic Sport hatchback still under factory warranty. Apple CarPlay, wireless charging, blind-spot monitoring and remote start. Never smoked in, always garage kept. Balance of Honda powertrain coverage transfers to the new owner.',
  },
  {
    sellerEmail: 'sales@northshoremotors.test',
    make: 'Ford',
    model: 'F-150',
    trim: 'Lariat SuperCrew',
    year: 2021,
    priceCad: 54750,
    mileageKm: 78400,
    condition: VehicleCondition.USED,
    bodyType: BodyType.TRUCK,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.FOUR_WHEEL_DRIVE,
    exteriorColour: 'Agate Black',
    vin: '1FTFW1E85MFA34567',
    province: Province.BC,
    city: 'North Vancouver',
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
    mileageKm: 29800,
    condition: VehicleCondition.USED,
    bodyType: BodyType.SEDAN,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.ELECTRIC,
    drivetrain: Drivetrain.AWD,
    exteriorColour: 'Pearl White',
    vin: '5YJ3E1EB8PF345678',
    province: Province.AB,
    city: 'Calgary',
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
    exteriorColour: 'Crystal Black Silica',
    vin: '4S4BTANC5L3456789',
    province: Province.AB,
    city: 'Calgary',
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
    exteriorColour: 'Bright White',
    vin: '1C6SRFFT6KN456789',
    province: Province.AB,
    city: 'Red Deer',
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
    exteriorColour: 'Machine Grey',
    vin: 'JM3KFBCM6M0678901',
    province: Province.ON,
    city: 'London',
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
    exteriorColour: 'Moonstone Grey',
    vin: 'WVWTA7CD8NW789012',
    province: Province.ON,
    city: 'London',
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
    exteriorColour: 'Portimao Blue',
    vin: '3MW5R7J09M8901234',
    province: Province.ON,
    city: 'London',
    imageCount: 3,
    description:
      '330i xDrive with the M Sport package, adaptive suspension and Harman Kardon sound. Full leather, heated steering wheel and wireless CarPlay. Just serviced with new brake pads and rotors front and rear. Accident free.',
  },
  {
    sellerEmail: 'priya.raman@example.test',
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
    imageCount: 2,
    description:
      'Selling our family CR-V EX-L as we have downsized to one vehicle. Leather, sunroof, heated seats and adaptive cruise. All maintenance done at the Honda dealer and I have every receipt. New all-season tires last spring. Non-smoking household, no pets.',
  },
  {
    sellerEmail: 'priya.raman@example.test',
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
    exteriorColour: 'Firecracker Red',
    vin: '1C4HJXFG8KW123456',
    province: Province.QC,
    city: 'Laval',
    imageCount: 3,
    description:
      'Wrangler Rubicon Unlimited with lockers, disconnecting sway bar and 33-inch tires. Hard top and soft top both included. Never off-roaded hard, mostly used for camping trips. Rust-proofed every year since new, which matters on Quebec roads.',
  },
  {
    sellerEmail: 'marc.tremblay@example.test',
    make: 'Volkswagen',
    model: 'Jetta',
    trim: 'Comfortline',
    year: 2020,
    priceCad: 21400,
    mileageKm: 91200,
    condition: VehicleCondition.USED,
    bodyType: BodyType.SEDAN,
    transmission: Transmission.AUTOMATIC,
    fuelType: FuelType.GASOLINE,
    drivetrain: Drivetrain.FWD,
    exteriorColour: 'Deep Black Pearl',
    vin: '3VWC57BU8LM234567',
    province: Province.QC,
    city: 'Montreal',
    imageCount: 2,
    description:
      'Jetta Comfortline with heated seats, sunroof and CarPlay. Excellent fuel economy at around 6.5 L/100 km on the highway. Winter tires included on separate rims. Selling because I am relocating and will not need a car downtown.',
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
    imageCount: 2,
    description:
      'Leaf SV Plus with the 62 kWh battery, roughly 350 km of real-world range in summer. ProPILOT assist, heated seats and steering wheel. Twelve of twelve battery health bars. Charges overnight on a standard Level 2 home charger.',
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
    exteriorColour: 'Predawn Grey Mica',
    vin: '5TDZRKEC8PS456789',
    province: Province.BC,
    city: 'Burnaby',
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
    exteriorColour: 'Race Red',
    vin: '1FA6P8CF5J5567890',
    province: Province.AB,
    city: 'Calgary',
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
    exteriorColour: 'Gravity Grey',
    vin: '5XYRH4JF6NG678901',
    province: Province.ON,
    city: 'London',
    imageCount: 2,
    description:
      'Three-row Sorento EX+ with all-wheel drive and the turbo four-cylinder. Seats seven with the third row up and still has usable cargo space. Balance of the Kia five-year comprehensive warranty remains. Great family hauler at a sensible price.',
  },
  {
    sellerEmail: 'priya.raman@example.test',
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
    imageCount: 2,
    description:
      'Mazda3 GS Sport in Soul Red. Heated seats, blind-spot monitoring and a very well put together interior for the price. Regular oil changes every 8,000 km. Now sold, kept visible as an example of a completed private sale.',
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
    imageCount: 1,
    description:
      'Q5 Progressiv with quattro all-wheel drive, virtual cockpit and panoramic roof. Still finishing the detail and gathering service records before publishing, so this listing is a work in progress and not yet live on the marketplace.',
  },
];

async function main() {
  mkdirSync(SEED_IMAGE_DIR, { recursive: true });

  console.log('Seeding users...');
  const usersByEmail = new Map<string, { id: string }>();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const seedUser of USERS) {
    const user = await prisma.user.upsert({
      where: { email: seedUser.email },
      update: {
        displayName: seedUser.displayName,
        role: seedUser.role,
        phone: seedUser.phone ?? null,
        province: seedUser.province ?? null,
        city: seedUser.city ?? null,
      },
      create: {
        email: seedUser.email,
        passwordHash,
        displayName: seedUser.displayName,
        role: seedUser.role,
        phone: seedUser.phone ?? null,
        province: seedUser.province ?? null,
        city: seedUser.city ?? null,
      },
      select: { id: true },
    });
    usersByEmail.set(seedUser.email, user);

    if (seedUser.dealershipName) {
      await prisma.dealership.upsert({
        where: { ownerId: user.id },
        update: { name: seedUser.dealershipName, verified: seedUser.dealershipVerified ?? false },
        create: {
          ownerId: user.id,
          name: seedUser.dealershipName,
          verified: seedUser.dealershipVerified ?? false,
        },
      });
    }
  }

  console.log('Seeding listings...');
  const listingIds: string[] = [];

  for (const [index, seedListing] of LISTINGS.entries()) {
    const seller = usersByEmail.get(seedListing.sellerEmail);
    if (!seller) throw new Error(`Unknown seller email: ${seedListing.sellerEmail}`);

    const status = seedListing.status ?? ListingStatus.ACTIVE;
    const title = `${seedListing.year} ${seedListing.make} ${seedListing.model}${
      seedListing.trim ? ` ${seedListing.trim}` : ''
    }`;
    // Stagger publish dates so "newest first" produces a believable ordering.
    const publishedAt =
      status === ListingStatus.ACTIVE || status === ListingStatus.SOLD
        ? new Date(Date.now() - index * 36 * 60 * 60 * 1000)
        : null;

    const existing = await prisma.listing.findFirst({
      where: { vin: seedListing.vin },
      select: { id: true },
    });

    const data = {
      sellerId: seller.id,
      title,
      description: seedListing.description,
      make: seedListing.make,
      model: seedListing.model,
      trim: seedListing.trim ?? null,
      year: seedListing.year,
      priceCad: seedListing.priceCad,
      mileageKm: seedListing.mileageKm,
      condition: seedListing.condition,
      bodyType: seedListing.bodyType,
      transmission: seedListing.transmission,
      fuelType: seedListing.fuelType,
      drivetrain: seedListing.drivetrain,
      exteriorColour: seedListing.exteriorColour,
      vin: seedListing.vin,
      province: seedListing.province,
      city: seedListing.city,
      status,
      publishedAt,
      viewCount: status === ListingStatus.ACTIVE ? 40 + index * 17 : 0,
    };

    const listing = existing
      ? await prisma.listing.update({ where: { id: existing.id }, data, select: { id: true } })
      : await prisma.listing.create({ data, select: { id: true } });

    listingIds.push(listing.id);

    // Images are regenerated wholesale so re-seeding never accumulates duplicates.
    await prisma.listingImage.deleteMany({ where: { listingId: listing.id } });
    const slug = slugify(`${seedListing.year}-${seedListing.make}-${seedListing.model}`);
    const imageCount = seedListing.imageCount ?? 2;
    await prisma.listingImage.createMany({
      data: Array.from({ length: imageCount }, (_, position) => ({
        listingId: listing.id,
        url: writePlaceholderImage(slug, title, position),
        alt: `${title} photo ${position + 1}`,
        position,
      })),
    });
  }

  console.log('Seeding favourites and conversations...');
  const buyerJordan = usersByEmail.get('jordan.lee@example.test')!;
  const buyerSam = usersByEmail.get('sam.okafor@example.test')!;

  // Favourite a handful of listings for each demo buyer.
  const favouritePairs = [
    { userId: buyerJordan.id, listingId: listingIds[0]! },
    { userId: buyerJordan.id, listingId: listingIds[3]! },
    { userId: buyerJordan.id, listingId: listingIds[16]! },
    { userId: buyerSam.id, listingId: listingIds[7]! },
    { userId: buyerSam.id, listingId: listingIds[11]! },
  ];
  for (const pair of favouritePairs) {
    await prisma.favourite.upsert({
      where: { userId_listingId: pair },
      update: {},
      create: pair,
    });
  }

  const threads = [
    {
      buyerId: buyerJordan.id,
      listingIndex: 0,
      messages: [
        {
          fromBuyer: true,
          body: 'Hi, is the RAV4 still available? I am interested in seeing it this weekend if so.',
        },
        {
          fromBuyer: false,
          body: 'Hello Jordan, yes it is still available. We are open Saturday from 9 to 5 — would 11am work for a test drive?',
        },
        {
          fromBuyer: true,
          body: 'Saturday at 11 works for me. Could you also send over the CarFax report before then?',
        },
      ],
    },
    {
      buyerId: buyerSam.id,
      listingIndex: 11,
      messages: [
        {
          fromBuyer: true,
          body: 'Hi Priya, I saw your CR-V listing. Has the timing belt or any major service been done recently?',
        },
        {
          fromBuyer: false,
          body: 'Hi Sam — the CR-V uses a timing chain so there is no belt to replace. It had a full brake service and new tires last spring, and I have all the receipts.',
        },
      ],
    },
    {
      buyerId: buyerJordan.id,
      listingIndex: 3,
      messages: [
        {
          fromBuyer: true,
          body: 'Would you consider a trade for my 2019 Golf, plus cash on my side? Happy to send details and photos.',
        },
      ],
    },
  ];

  for (const thread of threads) {
    const listingId = listingIds[thread.listingIndex]!;
    const listing = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      select: { sellerId: true },
    });

    const conversation = await prisma.conversation.upsert({
      where: { listingId_buyerId: { listingId, buyerId: thread.buyerId } },
      update: {},
      create: { listingId, buyerId: thread.buyerId, sellerId: listing.sellerId },
      select: { id: true },
    });

    // Rewrite the thread so re-seeding produces the same conversation, not a longer one.
    await prisma.message.deleteMany({ where: { conversationId: conversation.id } });

    let lastMessageAt = new Date();
    for (const [messageIndex, message] of thread.messages.entries()) {
      // Space messages a few hours apart, oldest first.
      lastMessageAt = new Date(
        Date.now() - (thread.messages.length - messageIndex) * 5 * 60 * 60 * 1000,
      );
      await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: conversation.id,
          senderId: message.fromBuyer ? thread.buyerId : listing.sellerId,
          body: message.body,
          // Everything except the final message is marked read.
          readAt: messageIndex < thread.messages.length - 1 ? lastMessageAt : null,
          createdAt: lastMessageAt,
        },
      });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt },
    });
  }

  const counts = {
    users: await prisma.user.count(),
    dealerships: await prisma.dealership.count(),
    listings: await prisma.listing.count(),
    images: await prisma.listingImage.count(),
    favourites: await prisma.favourite.count(),
    conversations: await prisma.conversation.count(),
    messages: await prisma.message.count(),
  };

  console.log('\nSeed complete:');
  for (const [label, value] of Object.entries(counts)) {
    console.log(`  ${label.padEnd(14)} ${value}`);
  }
  console.log(`\nAll demo accounts use the password: ${DEMO_PASSWORD}`);
  console.log('  admin@atlas.test                 (admin)');
  console.log('  sales@northshoremotors.test      (dealer)');
  console.log('  priya.raman@example.test         (private seller)');
  console.log('  jordan.lee@example.test          (buyer)');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
