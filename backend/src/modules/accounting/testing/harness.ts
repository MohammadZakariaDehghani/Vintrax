import { randomUUID } from 'node:crypto';
import type { AccountingSetupInput } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { contextFor, type AccountingContext } from '../core/context';
import { PostingService } from '../journal/posting.service';
import { AccountingSettingsService } from '../settings/settings.service';

/**
 * Database-backed accounting tests run against a real Postgres with the
 * migrations applied — the triggers are part of what is under test. They run
 * when DATABASE_URL is set (CI sets it; locally point it at a test database)
 * and are skipped otherwise.
 *
 * Every test creates its own dealership, so tests never see each other's
 * books and nothing needs deleting (posted rows cannot be deleted anyway).
 */
export const describeDb = process.env['DATABASE_URL'] ? describe : describe.skip;

let shared: PrismaService | null = null;

export function testPrisma(): PrismaService {
  shared ??= new PrismaService();
  return shared;
}

export async function closeTestPrisma(): Promise<void> {
  if (shared) await shared.$disconnect();
  shared = null;
}

export interface TestDealer {
  ctx: AccountingContext;
  ownerId: string;
  dealerId: string;
}

/** A dealership owner and their dealership, not yet set up for accounting. */
export async function createDealer(
  prisma: PrismaService,
  name = 'Test Motors',
): Promise<TestDealer> {
  const suffix = randomUUID().slice(0, 8);
  const owner = await prisma.user.create({
    data: {
      email: `owner-${suffix}@example.test`,
      passwordHash: 'x',
      firstName: 'Olive',
      lastName: 'Owner',
      role: 'DEALER',
      status: 'ACTIVE',
      emailVerified: true,
    },
  });
  const dealer = await prisma.dealer.create({
    data: {
      ownerId: owner.id,
      name: `${name} ${suffix}`,
      slug: `test-motors-${suffix}`,
      province: 'ON',
    },
  });
  return {
    ownerId: owner.id,
    dealerId: dealer.id,
    ctx: contextFor(dealer.id, owner.id, owner.id, owner.email, 'OWNER'),
  };
}

export { contextFor };

export async function setUpAccounting(
  prisma: PrismaService,
  dealer: TestDealer,
  overrides: Partial<AccountingSetupInput> = {},
): Promise<void> {
  const settings = new AccountingSettingsService(prisma, new PostingService());
  await settings.setup(dealer.ctx, {
    legalName: 'Test Motors Ltd.',
    businessNumber: null,
    gstHstNumber: '123456789RT0001',
    pstNumber: null,
    qstNumber: null,
    province: 'ON',
    fiscalYearStartMonth: 1,
    fiscalYearStartDay: 1,
    taxFilingFrequency: 'QUARTERLY',
    openingBank: {
      name: 'Operating chequing',
      bankName: 'Test Bank',
      accountNumberLast4: '4321',
      openingBalance: 5_000_000,
    },
    ...overrides,
  });
}

/** A vehicle in the dealer's inventory (owned by the dealership owner). */
export async function createVehicle(
  prisma: PrismaService,
  ownerId: string,
  overrides: {
    make?: string;
    model?: string;
    year?: number;
    condition?: 'NEW' | 'USED';
    priceCad?: number;
    vin?: string;
  } = {},
): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const vehicle = await prisma.vehicle.create({
    data: {
      slug: `test-${suffix}`,
      sellerId: ownerId,
      title: `${overrides.year ?? 2020} ${overrides.make ?? 'Honda'} ${overrides.model ?? 'Civic'}`,
      description: 'A test vehicle for accounting.',
      vin: overrides.vin ?? null,
      make: overrides.make ?? 'Honda',
      model: overrides.model ?? 'Civic',
      year: overrides.year ?? 2020,
      priceCad: overrides.priceCad ?? 28_000,
      mileageKm: 60_000,
      condition: overrides.condition ?? 'USED',
      bodyType: 'SEDAN',
      transmission: 'AUTOMATIC',
      fuelType: 'GASOLINE',
      drivetrain: 'FWD',
      province: 'ON',
      city: 'Toronto',
      status: 'ACTIVE',
    },
  });
  return vehicle.id;
}

export async function accountId(
  prisma: PrismaService,
  dealerId: string,
  systemKey: string,
): Promise<string> {
  const account = await prisma.acctAccount.findFirstOrThrow({ where: { dealerId, systemKey } });
  return account.id;
}

export async function accountByCode(
  prisma: PrismaService,
  dealerId: string,
  code: string,
): Promise<string> {
  const account = await prisma.acctAccount.findFirstOrThrow({ where: { dealerId, code } });
  return account.id;
}
