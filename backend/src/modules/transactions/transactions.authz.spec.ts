import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ROLE_PERMISSIONS, USER_ROLES, type UserRole } from '@vintrax/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { TransactionsService } from './transactions.service';

/**
 * Who may record that an order was paid.
 *
 * Vintrax records payments rather than processing them, so `POST /orders/:id/payment`
 * is an assertion that money arrived. Letting the buyer make that assertion
 * about their own purchase would let anyone take a vehicle for free, which is
 * why this is tested at the service and not only through the route guard.
 */

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function user(id: string, role: UserRole): AuthUser {
  return {
    id,
    email: `${id}@example.test`,
    firstName: 'Test',
    lastName: 'User',
    role,
    status: 'ACTIVE',
    emailVerified: true,
    dealerId: null,
  };
}

const buyer = user('buyer', 'BUYER');
const seller = user('seller', 'SELLER');
const admin = user('admin', 'ADMIN');
const stranger = user('stranger', 'BUYER');

/**
 * Just enough Prisma to answer the ownership lookup. Any write reaching the
 * database is itself a failure, so the write surface throws.
 */
function serviceWithOrder(status = 'AWAITING_PAYMENT') {
  const record = {
    id: ORDER_ID,
    vehicleId: 'vehicle',
    buyerId: buyer.id,
    sellerId: seller.id,
    status,
    payment: { status: 'PENDING' },
  };

  const wrote = { count: 0 };
  const prisma = {
    transactionRecord: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === ORDER_ID ? record : null,
      ),
    },
    $transaction: jest.fn(async () => {
      wrote.count += 1;
      return [];
    }),
  };

  const audit = { record: jest.fn(async () => undefined) };

  return {
    service: new TransactionsService(prisma as never, audit as never),
    wrote,
  };
}

describe('recording a payment', () => {
  it('refuses a buyer marking their own order paid', async () => {
    const { service, wrote } = serviceWithOrder();

    await expect(
      service.confirmPayment(ORDER_ID, { providerReference: 'free-car' }, buyer),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // The check must happen before the write, not merely be reported after it.
    expect(wrote.count).toBe(0);
  });

  it('refuses someone who is neither buyer nor seller, without confirming the order exists', async () => {
    const { service } = serviceWithOrder();

    await expect(
      service.confirmPayment(ORDER_ID, { providerReference: 'x' }, stranger),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows the seller, who is the party actually owed the money', async () => {
    const { service } = serviceWithOrder();

    // findById is reached after the write and needs more of Prisma than this
    // fake provides; getting past the authorization check is the assertion.
    await expect(
      service.confirmPayment(ORDER_ID, { providerReference: 'ok' }, seller),
    ).rejects.not.toBeInstanceOf(ForbiddenException);
  });

  it('allows an administrator, for support and reconciliation', async () => {
    const { service } = serviceWithOrder();

    await expect(
      service.confirmPayment(ORDER_ID, { providerReference: 'ok' }, admin),
    ).rejects.not.toBeInstanceOf(ForbiddenException);
  });

  it('still rejects a cancelled order before touching the payment row', async () => {
    const { service, wrote } = serviceWithOrder('CANCELLED');

    await expect(
      service.confirmPayment(ORDER_ID, { providerReference: 'ok' }, seller),
    ).rejects.toThrow('This order was cancelled');
    expect(wrote.count).toBe(0);
  });
});

describe('the payment:manage permission', () => {
  it('is not held by buyers', () => {
    expect(ROLE_PERMISSIONS.BUYER).not.toContain('payment:manage');
  });

  it('is held by every role that can be the seller on an order', () => {
    for (const role of ['SELLER', 'DEALER'] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain('payment:manage');
    }
  });

  it('is held by administrators', () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN'] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain('payment:manage');
    }
  });

  it('is not handed out by accident to inspectors', () => {
    expect(ROLE_PERMISSIONS.INSPECTOR).not.toContain('payment:manage');
  });

  it('leaves every role with a defined permission set', () => {
    for (const role of USER_ROLES) {
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });
});
