import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { VIN_PATTERN } from '@vintrax/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  bodyTypeFrom,
  drivetrainFrom,
  fuelTypeFrom,
  makeName,
  toVinDecodeResult,
  transmissionFrom,
} from './vin-decode';
import { VinService } from './vin.service';

/** vPIC's answer for the VIN in the dealer's screenshots, trimmed to what is read. */
const CRV_2000 = {
  Make: 'HONDA',
  Model: 'CR-V',
  ModelYear: '2000',
  Trim: 'SE',
  Series: '',
  BodyClass: 'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)',
  DriveType: '4WD/4-Wheel Drive/4x4',
  TransmissionStyle: 'Automatic',
  FuelTypePrimary: 'Gasoline',
  ElectrificationLevel: '',
  DisplacementL: '2.0',
  EngineCylinders: '4',
  Doors: '4',
  Seats: '',
  EngineHP: '',
  ErrorCode: '0',
};

describe('reading a vPIC answer', () => {
  it('turns the 2000 Honda CR-V into the form’s fields and style line', () => {
    const result = toVinDecodeResult('JHLRD1871YC810608', CRV_2000);

    expect(result).toEqual({
      vin: 'JHLRD1871YC810608',
      checkDigitValid: true,
      make: 'Honda',
      model: 'CR-V',
      year: 2000,
      trim: 'SE',
      style: 'CR-V 4WD SE Auto (Gasoline, 2.0L)',
      bodyType: 'SUV',
      drivetrain: 'FOUR_WHEEL_DRIVE',
      transmission: 'AUTOMATIC',
      fuelType: 'GASOLINE',
      engine: '2.0L 4-cylinder',
      engineSizeL: 2,
      cylinders: 4,
      doors: 4,
      seats: null,
      horsepower: null,
    });
  });

  it('leaves out what vPIC did not know, rather than inventing it', () => {
    const result = toVinDecodeResult('1HGCM82633A004352', {
      Make: 'HONDA',
      Model: 'Accord',
      ModelYear: '2003',
      Trim: 'Not Applicable',
      BodyClass: '',
    });
    expect(result.trim).toBeNull();
    expect(result.bodyType).toBeNull();
    expect(result.engine).toBeNull();
    expect(result.style).toBe('Accord');
  });

  it('names makes the way they are written', () => {
    expect(makeName('HONDA')).toBe('Honda');
    expect(makeName('LAND ROVER')).toBe('Land Rover');
    expect(makeName('MERCEDES-BENZ')).toBe('Mercedes-Benz');
    expect(makeName('BMW')).toBe('BMW');
    expect(makeName('RAM')).toBe('Ram');
    expect(makeName('')).toBeNull();
  });

  it('maps body, drive, gearbox and fuel onto Vintrax’s lists', () => {
    expect(bodyTypeFrom('Pickup')).toBe('TRUCK');
    expect(bodyTypeFrom('Sedan/Saloon')).toBe('SEDAN');
    expect(bodyTypeFrom('Minivan')).toBe('MINIVAN');
    expect(bodyTypeFrom('Hatchback/Liftback/Notchback')).toBe('HATCHBACK');
    expect(bodyTypeFrom('Convertible/Cabriolet')).toBe('CONVERTIBLE');
    expect(drivetrainFrom('AWD/All-Wheel Drive')).toBe('AWD');
    expect(drivetrainFrom('FWD/Front-Wheel Drive')).toBe('FWD');
    expect(drivetrainFrom('RWD/ Rear-Wheel Drive')).toBe('RWD');
    expect(transmissionFrom('Continuously Variable Transmission (CVT)')).toBe('CVT');
    expect(transmissionFrom('Dual-Clutch Transmission (DCT)')).toBe('DUAL_CLUTCH');
    expect(transmissionFrom('Manual/Standard')).toBe('MANUAL');
    expect(fuelTypeFrom('Gasoline', 'Strong HEV (Hybrid Electric Vehicle)')).toBe('HYBRID');
    expect(fuelTypeFrom('Gasoline', 'PHEV (Plug-in Hybrid Electric Vehicle)')).toBe(
      'PLUG_IN_HYBRID',
    );
    expect(fuelTypeFrom('Electric', 'BEV (Battery Electric Vehicle)')).toBe('ELECTRIC');
    expect(fuelTypeFrom('Diesel', '')).toBe('DIESEL');
    expect(fuelTypeFrom('Flexible Fuel Vehicle (FFV)', '')).toBe('GASOLINE');
  });
});

describe('VinService', () => {
  function service(fetchImpl: typeof fetch) {
    const store = new Map<string, unknown>();
    const redis = {
      remember: async <T>(key: string, _ttl: number, load: () => Promise<T>): Promise<T> => {
        if (!store.has(key)) store.set(key, await load());
        return store.get(key) as T;
      },
    };
    const vins = new VinService(redis as never);
    vins.fetchImpl = fetchImpl;
    return vins;
  }

  it('asks NHTSA once per VIN, and only NHTSA', async () => {
    const fetchImpl = jest.fn(
      async (_url: string) =>
        new Response(JSON.stringify({ Results: [CRV_2000] }), { status: 200 }),
    );
    const vins = service(fetchImpl as unknown as typeof fetch);

    await expect(vins.decode('JHLRD1871YC810608')).resolves.toMatchObject({ make: 'Honda' });
    await vins.decode('JHLRD1871YC810608');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/JHLRD1871YC810608?format=json',
    );
  });

  it('says so when the VIN decodes to nothing', async () => {
    const vins = service(
      (async () =>
        new Response(JSON.stringify({ Results: [{ Make: '', Model: '', ErrorCode: '11' }] }), {
          status: 200,
        })) as unknown as typeof fetch,
    );
    await expect(vins.decode('JHLRD1871YC810608')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 503, not 500, when NHTSA is down or slow', async () => {
    const down = service((async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    await expect(down.decode('JHLRD1871YC810608')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    const erroring = service(
      (async () => new Response('busy', { status: 502 })) as unknown as typeof fetch,
    );
    await expect(erroring.decode('JHLRD1871YC810608')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('the VIN in the route', () => {
  const pipe = new ZodValidationPipe(z.string().trim().toUpperCase().regex(VIN_PATTERN));

  it('is upper-cased, and refused when it cannot be a VIN', () => {
    expect(pipe.transform('jhlrd1871yc810608')).toBe('JHLRD1871YC810608');
    expect(() => pipe.transform('JHLRD1871YC81060')).toThrow();
    expect(() => pipe.transform('JHLRD1871YC81060O')).toThrow();
    expect(() => pipe.transform('../../admin/users')).toThrow();
  });
});
