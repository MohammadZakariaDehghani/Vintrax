import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VehicleDetail } from '@vintrax/shared';
import robots from '@/app/robots';
import { absoluteUrl, siteUrl } from './site-url';
import { jsonLdScript, vehicleStructuredData } from './vehicle-structured-data';

/**
 * What search engines are told: the public origin, which paths to crawl, and
 * the structured description of a car. The rule throughout is that nothing is
 * claimed that the listing does not state.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

function listing(overrides: Partial<VehicleDetail> = {}): VehicleDetail {
  return {
    slug: '2021-mazda-cx-5-gt',
    title: '2021 Mazda CX-5 GT',
    description: 'One owner. Winter tires included.',
    make: 'Mazda',
    model: 'CX-5',
    trim: 'GT',
    year: 2021,
    priceCad: 31_900,
    mileageKm: 48_900,
    condition: 'USED',
    bodyType: 'SUV',
    fuelType: 'GASOLINE',
    transmission: 'AUTOMATIC',
    drivetrain: 'AWD',
    exteriorColour: null,
    doors: null,
    seats: null,
    vin: null,
    status: 'ACTIVE',
    city: 'Halifax',
    province: 'NS',
    images: [{ url: '/uploads/vehicles/a.webp' }],
    seller: { displayName: 'Dana L.', dealer: { name: 'North Shore Motors' } },
    ...overrides,
  } as unknown as VehicleDetail;
}

const build = (vehicle: VehicleDetail) =>
  vehicleStructuredData(vehicle, 'https://vintrax.example/vehicles/x', (path) => absoluteUrl(path));

describe('the public origin', () => {
  it('comes from SITE_URL, then APP_URL, without a trailing slash', () => {
    vi.stubEnv('SITE_URL', 'https://vintrax.example/');
    expect(siteUrl()).toBe('https://vintrax.example');
    vi.stubEnv('SITE_URL', '');
    vi.stubEnv('APP_URL', 'https://app.vintrax.example');
    expect(siteUrl()).toBe('https://app.vintrax.example');
  });

  it('survives an unset or malformed value rather than breaking every page', () => {
    vi.stubEnv('SITE_URL', 'not a url');
    vi.stubEnv('APP_URL', '');
    expect(siteUrl()).toBe('http://localhost:3000');
  });

  it('makes site paths absolute and leaves absolute URLs alone', () => {
    vi.stubEnv('SITE_URL', 'https://vintrax.example');
    expect(absoluteUrl('/uploads/a.webp')).toBe('https://vintrax.example/uploads/a.webp');
    expect(absoluteUrl('https://cdn.example/a.webp')).toBe('https://cdn.example/a.webp');
  });
});

describe('robots.txt', () => {
  it('keeps signed-in areas out of the index but not the public dealer pages', () => {
    vi.stubEnv('SITE_URL', 'https://vintrax.example');
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0]! : result.rules;
    const disallow = [rules.disallow].flat() as string[];

    expect(disallow).toEqual(expect.arrayContaining(['/admin', '/dealer/', '/dashboard']));
    // "/dealer" without the slash would also block /dealers/north-shore-motors.
    expect(disallow.some((path) => '/dealers/north-shore-motors'.startsWith(path))).toBe(false);
    expect(result.sitemap).toBe('https://vintrax.example/sitemap.xml');
  });
});

describe('vehicle structured data', () => {
  it('describes the car, its mileage in kilometres and its price in dollars', () => {
    vi.stubEnv('SITE_URL', 'https://vintrax.example');
    const data = build(listing());

    expect(data).toMatchObject({
      '@type': 'Car',
      name: '2021 Mazda CX-5 GT',
      brand: { name: 'Mazda' },
      model: 'CX-5',
      vehicleModelDate: '2021',
      mileageFromOdometer: { value: 48_900, unitCode: 'KMT' },
      itemCondition: 'https://schema.org/UsedCondition',
      image: ['https://vintrax.example/uploads/vehicles/a.webp'],
      offers: {
        price: 31_900,
        priceCurrency: 'CAD',
        availability: 'https://schema.org/InStock',
        seller: { '@type': 'AutoDealer', name: 'North Shore Motors' },
      },
    });
  });

  it('leaves out what the seller did not state', () => {
    const data = build(listing());
    for (const key of [
      'vehicleIdentificationNumber',
      'color',
      'numberOfDoors',
      'seatingCapacity',
    ]) {
      expect(data).not.toHaveProperty(key);
    }
  });

  it('offers nothing for a listing that is not for sale', () => {
    expect(build(listing({ status: 'PENDING_REVIEW' }))).not.toHaveProperty('offers');
    expect(build(listing({ status: 'SOLD' }))).toMatchObject({
      offers: { availability: 'https://schema.org/SoldOut' },
    });
  });

  it('cannot be closed early by text in the listing', () => {
    const script = jsonLdScript(build(listing({ title: '</script><script>alert(1)</script>' })));
    expect(script).not.toContain('</script>');
    expect(JSON.parse(script).name).toBe('</script><script>alert(1)</script>');
  });
});
