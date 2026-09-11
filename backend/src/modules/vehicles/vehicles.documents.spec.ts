import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { StorageService } from '../../common/storage/storage.service';
import { toVehicleDetail, type VehicleDetailRow } from './vehicles.mapper';

/**
 * Vehicle paperwork — registration, title, CarFax, bill of sale — carries the
 * owner's name, address and VIN history. It is not part of a public listing,
 * and these tests pin the two halves of that: what the API hands back, and
 * where a recorded URL is allowed to resolve to on disk.
 */

const uploadDir = mkdtempSync(join(tmpdir(), 'vintrax-storage-'));

function storage(): StorageService {
  const values: Record<string, unknown> = {
    STORAGE_DRIVER: 'local',
    UPLOAD_DIR: uploadDir,
    MAX_UPLOAD_BYTES: 10_485_760,
  };
  const config = { get: (key: string) => values[key] };
  return new StorageService(config as never);
}

function vehicleRow(): VehicleDetailRow {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'vehicle-1',
    slug: 'vehicle-1',
    title: '2020 Test Car',
    make: 'Test',
    model: 'Car',
    trim: null,
    year: 2020,
    priceCad: 20_000,
    mileageKm: 10_000,
    condition: 'USED',
    bodyType: 'SEDAN',
    fuelType: 'GASOLINE',
    transmission: 'AUTOMATIC',
    drivetrain: 'FWD',
    province: 'ON',
    city: 'Toronto',
    status: 'ACTIVE',
    saleChannel: 'FIXED_PRICE',
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    description: 'A car.',
    vin: null,
    engine: null,
    engineSizeL: null,
    cylinders: null,
    doors: null,
    seats: null,
    exteriorColour: null,
    interiorColour: null,
    postalCode: null,
    features: [],
    viewCount: 0,
    favouriteCount: 0,
    images: [],
    _count: { images: 0 },
    inspections: [],
    auctions: [],
    documents: [
      {
        id: 'doc-1',
        type: 'TITLE',
        url: '/uploads/documents/9f1c.pdf',
        filename: 'title.pdf',
        sizeBytes: 1024,
        createdAt: now,
      },
    ],
    seller: {
      id: 'seller-1',
      firstName: 'Sam',
      lastName: 'Seller',
      role: 'SELLER',
      province: 'ON',
      city: 'Toronto',
      createdAt: now,
      dealer: null,
    },
  } as unknown as VehicleDetailRow;
}

describe('documents in the vehicle detail response', () => {
  it('are withheld by default, so a caller has to opt in deliberately', () => {
    const detail = toVehicleDetail(vehicleRow(), new Set());

    expect(detail.documents).toEqual([]);
  });

  it('still report how many exist, so the page can explain the gap', () => {
    const detail = toVehicleDetail(vehicleRow(), new Set());

    expect(detail.documentCount).toBe(1);
  });

  it('never disclose where the file is stored, even to an authorized viewer', () => {
    const detail = toVehicleDetail(vehicleRow(), new Set(), { includeDocuments: true });

    expect(detail.documents).toHaveLength(1);
    expect(detail.documents[0]!.url).toBe('/vehicles/vehicle-1/documents/doc-1');
    expect(detail.documents[0]!.url).not.toContain('/uploads/');
  });

  it('keep the rest of the payload identical either way', () => {
    const withheld = toVehicleDetail(vehicleRow(), new Set());
    const shared = toVehicleDetail(vehicleRow(), new Set(), { includeDocuments: true });

    expect({ ...withheld, documents: null }).toEqual({ ...shared, documents: null });
  });
});

describe('resolving a recorded storage URL', () => {
  it('accepts a key written by the upload path', () => {
    const resolved = storage().resolveStored('/uploads/documents/9f1c.pdf');

    expect(resolved).toEqual({
      kind: 'local',
      path: join(uploadDir, 'documents', '9f1c.pdf'),
      contentType: 'application/pdf',
    });
  });

  it('refuses a relative path that climbs out of the upload directory', () => {
    // The URL arrives in the payload a seller sends, so this is attacker input.
    expect(() => storage().resolveStored('/uploads/../../etc/passwd')).toThrow(BadRequestException);
  });

  it('refuses an absolute path, which would otherwise override the join', () => {
    expect(() => storage().resolveStored('/etc/shadow')).toThrow(BadRequestException);
  });

  it('refuses a sibling directory that merely shares the prefix', () => {
    expect(() => storage().resolveStored(`/uploads/..${sep}${uploadDir}-evil/x.pdf`)).toThrow(
      BadRequestException,
    );
  });

  it('passes an object-storage URL through for the bucket to serve', () => {
    expect(storage().resolveStored('https://cdn.example.test/vintrax/documents/a.pdf')).toEqual({
      kind: 'remote',
      url: 'https://cdn.example.test/vintrax/documents/a.pdf',
    });
  });

  it('does not guess a content type it was not told about', () => {
    const resolved = storage().resolveStored('/uploads/documents/9f1c.bin');

    expect(resolved).toMatchObject({ contentType: 'application/octet-stream' });
  });
});
