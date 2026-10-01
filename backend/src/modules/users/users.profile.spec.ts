import { ConflictException } from '@nestjs/common';
import { defaultUsername, updateProfileSchema } from '@vintrax/shared';
import { UsersService } from './users.service';

/** Account settings: the handle and the postal code a private seller can change. */

describe('a username', () => {
  it('is saved in lowercase and must look like a handle', () => {
    expect(updateProfileSchema.parse({ username: '  Sam.Seller_1 ' }).username).toBe(
      'sam.seller_1',
    );
    for (const bad of ['ab', '_lead', 'has space', 'émile', 'x'.repeat(31)]) {
      expect(updateProfileSchema.safeParse({ username: bad }).success).toBe(false);
    }
  });

  it('cannot be one somebody else already has', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'someone-else' }),
        update: jest.fn(),
      },
    };
    const users = new UsersService(prisma as never, {} as never);
    await expect(users.updateProfile('me', { username: 'taken' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('is given at sign-up from the first name and the id', () => {
    expect(defaultUsername('Zoë-Anne', '3f8a4f2e-6c1b-4a8e-9b0d-1c2d3e4f5a6b')).toBe(
      'zoeanne3f8a4f2e',
    );
  });
});

describe('a postal code', () => {
  it('takes a full code or just the area, in capitals with the usual space', () => {
    expect(updateProfileSchema.parse({ postalCode: 'v5l1a1' }).postalCode).toBe('V5L 1A1');
    expect(updateProfileSchema.parse({ postalCode: 'v5l' }).postalCode).toBe('V5L');
    expect(updateProfileSchema.parse({ postalCode: null }).postalCode).toBeNull();
    expect(updateProfileSchema.safeParse({ postalCode: '12345' }).success).toBe(false);
  });
});
