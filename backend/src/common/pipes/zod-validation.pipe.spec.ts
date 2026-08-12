import { BadRequestException } from '@nestjs/common';
import { createListingSchema, registerSchema } from '@atlas/shared';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  it('returns the parsed value with defaults and coercion applied', () => {
    const pipe = new ZodValidationPipe(createListingSchema);

    const result = pipe.transform({
      title: '2020 Honda Civic LX',
      description: 'A description long enough to satisfy the minimum length rule.',
      make: 'Honda',
      model: 'Civic',
      // Numeric fields arrive as strings from multipart and query sources.
      year: '2020',
      priceCad: '22000',
      mileageKm: '80000',
      condition: 'USED',
      bodyType: 'SEDAN',
      transmission: 'AUTOMATIC',
      fuelType: 'GASOLINE',
      drivetrain: 'FWD',
      province: 'ON',
      city: 'Toronto',
    });

    expect(result.year).toBe(2020);
    expect(result.priceCad).toBe(22000);
    expect(result.status).toBe('DRAFT');
    expect(result.images).toEqual([]);
  });

  it('reports every failing field at once, keyed by path', () => {
    const pipe = new ZodValidationPipe(registerSchema);

    expect.assertions(3);
    try {
      pipe.transform({ email: 'nope', password: 'short', displayName: 'A' });
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        details: Record<string, string[]>;
      };
      expect(Object.keys(response.details).sort()).toEqual(['displayName', 'email', 'password']);
      expect(response.details['password']).toContain('Password must be at least 10 characters');
    }
  });

  it('attaches whole-object refinements to the field they concern', () => {
    const pipe = new ZodValidationPipe(registerSchema);

    try {
      // A dealer signup with no dealership name fails a cross-field refinement.
      pipe.transform({
        email: 'dealer@example.test',
        password: 'a-long-enough-password',
        displayName: 'Dealer',
        role: 'DEALER',
      });
      throw new Error('expected validation to fail');
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as {
        details: Record<string, string[]>;
      };
      expect(response.details['dealershipName']).toEqual([
        'Dealership name is required for dealer accounts',
      ]);
    }
  });

  it('rejects a VIN containing the letters the standard excludes', () => {
    const pipe = new ZodValidationPipe(createListingSchema.pick({ vin: true }));
    expect(() => pipe.transform({ vin: 'IOQ45678901234567' })).toThrow(BadRequestException);
  });
});
