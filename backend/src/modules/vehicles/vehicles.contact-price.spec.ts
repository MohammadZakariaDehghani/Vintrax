import { NotFoundException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { previousPriceUpdate } from './previous-price';

/**
 * Two listing details a buyer sees: the seller's phone number, shown only to
 * a signed-in visitor who asks for it, and a changed price, shown with the
 * old one struck through above it.
 */

const buyer = { id: 'buyer-1', email: 'b@example.com', role: 'BUYER' } as never;
const admin = { id: 'admin-1', email: 'a@example.com', role: 'ADMIN' } as never;

function service(row: unknown) {
  const prisma = { vehicle: { findUnique: jest.fn().mockResolvedValue(row) } };
  return new VehiclesService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

const listing = (
  status: string,
  seller: { phone: string | null; dealer: { name: string; phone: string | null } | null },
) => ({
  status,
  seller: { id: 'seller-1', firstName: 'Pat', lastName: 'Seller', ...seller },
});

describe("a listing's phone number", () => {
  it("gives the dealership's own number first", async () => {
    const contact = await service(
      listing('ACTIVE', {
        phone: '514 555 0001',
        dealer: { name: 'North Motors', phone: '514 555 0100' },
      }),
    ).sellerContact('vehicle-1', buyer);
    expect(contact).toEqual({ name: 'North Motors', phone: '514 555 0100' });
  });

  it("falls back to the seller's own number", async () => {
    const contact = await service(
      listing('ACTIVE', { phone: '514 555 0001', dealer: { name: 'North Motors', phone: null } }),
    ).sellerContact('vehicle-1', buyer);
    expect(contact.phone).toBe('514 555 0001');
  });

  it('says there is none rather than inventing one', async () => {
    const contact = await service(listing('ACTIVE', { phone: null, dealer: null })).sellerContact(
      'vehicle-1',
      buyer,
    );
    expect(contact).toEqual({ name: 'Pat Seller', phone: null });
  });

  it('does not reveal a draft to another account, but does to an administrator', async () => {
    const draft = listing('DRAFT', { phone: '514 555 0001', dealer: null });
    await expect(service(draft).sellerContact('vehicle-1', buyer)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service(draft).sellerContact('vehicle-1', admin)).resolves.toMatchObject({
      phone: '514 555 0001',
    });
  });
});

describe('the struck-through previous price', () => {
  it('keeps the price a change replaces', () => {
    expect(previousPriceUpdate(25_000, 23_500)).toEqual({ previousPriceCad: 25_000 });
  });

  it('is kept for a rise as well as a drop, since the dealer changed it', () => {
    expect(previousPriceUpdate(23_500, 24_000)).toEqual({ previousPriceCad: 23_500 });
  });

  /** An unrelated edit must not wipe a price drop the listing is showing. */
  it('writes nothing when the price is not touched or is saved unchanged', () => {
    expect(previousPriceUpdate(25_000, undefined)).toEqual({});
    expect(previousPriceUpdate(25_000, 25_000)).toEqual({});
  });
});
