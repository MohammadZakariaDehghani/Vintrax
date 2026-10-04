import { randomUUID } from 'node:crypto';
import {
  Global,
  Injectable,
  Module,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { UserRole } from '@vintrax/shared';
import request from 'supertest';
import type { AuthUser } from '../../common/auth/auth-user';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AccountingModule } from './accounting.module';
import { todayIso } from './core/dates';
import { closeTestPrisma, createVehicle, describeDb, testPrisma } from './testing/harness';

/**
 * The accounting API end to end over a real database: the real controllers,
 * validation, AccountingGuard, services and triggers. Only authentication is
 * stood in for — the caller's user id arrives in a test header.
 */

@Injectable()
class TestAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: AuthUser }>();
    const id = req.headers['x-test-user'];
    if (!id) return true;
    const user = await testPrisma().user.findUniqueOrThrow({ where: { id } });
    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role as UserRole,
      status: user.status,
      emailVerified: user.emailVerified,
      dealerId: null,
    };
    return true;
  }
}

@Global()
@Module({
  providers: [
    { provide: PrismaService, useFactory: () => testPrisma() },
    { provide: StorageService, useValue: { uploadDocument: jest.fn(), resolveStored: jest.fn() } },
  ],
  exports: [PrismaService, StorageService],
})
class TestPlatformModule {}

describeDb('accounting API', () => {
  const prisma = testPrisma();
  let app: INestApplication;
  const today = todayIso();

  const users: Record<
    | 'owner'
    | 'accountant'
    | 'sales'
    | 'salesManager'
    | 'otherOwner'
    | 'admin'
    | 'superAdmin'
    | 'stranger',
    string
  > = {
    owner: '',
    accountant: '',
    sales: '',
    salesManager: '',
    otherOwner: '',
    admin: '',
    superAdmin: '',
    stranger: '',
  };
  let dealerId = '';
  let otherDealerId = '';

  async function makeUser(label: string, role: UserRole = 'BUYER') {
    const suffix = randomUUID().slice(0, 8);
    const user = await prisma.user.create({
      data: {
        email: `${label}-${suffix}@example.test`,
        passwordHash: 'x',
        firstName: label,
        lastName: 'Test',
        role,
        status: 'ACTIVE',
        emailVerified: true,
      },
    });
    return user;
  }

  const as = (who: keyof typeof users) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('x-test-user', users[who]),
    post: (url: string) => request(app.getHttpServer()).post(url).set('x-test-user', users[who]),
    patch: (url: string) => request(app.getHttpServer()).patch(url).set('x-test-user', users[who]),
  });
  const base = '/dealer/accounting';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ MAX_UPLOAD_BYTES: 10_000_000, IMAGE_MAX_UPLOAD_BYTES: 10_000_000 })],
        }),
        TestPlatformModule,
        AccountingModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: TestAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const owner = await makeUser('owner', 'DEALER');
    users.owner = owner.id;
    const dealer = await prisma.dealer.create({
      data: {
        ownerId: owner.id,
        name: `API Motors ${owner.id.slice(0, 6)}`,
        slug: `api-motors-${owner.id.slice(0, 8)}`,
        province: 'ON',
      },
    });
    dealerId = dealer.id;

    const otherOwner = await makeUser('other', 'DEALER');
    users.otherOwner = otherOwner.id;
    const other = await prisma.dealer.create({
      data: {
        ownerId: otherOwner.id,
        name: `Other Motors ${otherOwner.id.slice(0, 6)}`,
        slug: `other-motors-${otherOwner.id.slice(0, 8)}`,
        province: 'BC',
      },
    });
    otherDealerId = other.id;

    users.accountant = (await makeUser('accountant')).id;
    users.sales = (await makeUser('sales')).id;
    users.salesManager = (await makeUser('salesmgr')).id;
    users.admin = (await makeUser('admin', 'ADMIN')).id;
    users.superAdmin = (await makeUser('superadmin', 'SUPER_ADMIN')).id;
    users.stranger = (await makeUser('stranger')).id;
  });

  afterAll(async () => {
    await app?.close();
    await closeTestPrisma();
  });

  it('refuses everything but status and setup until accounting is set up', async () => {
    const status = await as('owner').get(`${base}/status`).expect(200);
    expect(status.body.setUp).toBe(false);
    expect(status.body.role).toBe('OWNER');
    const blocked = await as('owner').get(`${base}/dashboard`).expect(409);
    expect(blocked.body.code).toBe('ACCOUNTING_NOT_SET_UP');
  });

  it('sets up accounting and adds staff with roles', async () => {
    await as('owner')
      .post(`${base}/setup`)
      .send({
        legalName: 'API Motors Ltd.',
        province: 'ON',
        fiscalYearStartMonth: 1,
        fiscalYearStartDay: 1,
        taxFilingFrequency: 'QUARTERLY',
        gstHstNumber: '123456789RT0001',
        openingBank: {
          name: 'Operating chequing',
          bankName: 'Test Bank',
          accountNumberLast4: '4321',
          openingBalance: '50000',
        },
      })
      .expect(201);
    await as('otherOwner')
      .post(`${base}/setup`)
      .send({
        legalName: 'Other Motors Ltd.',
        province: 'BC',
        fiscalYearStartMonth: 4,
        fiscalYearStartDay: 1,
        taxFilingFrequency: 'MONTHLY',
      })
      .expect(201);

    for (const [who, role] of [
      ['accountant', 'ACCOUNTANT'],
      ['sales', 'SALES_USER'],
      ['salesManager', 'SALES_MANAGER'],
    ] as const) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: users[who] } });
      await as('owner').post(`${base}/team`).send({ email: user.email, role }).expect(201);
    }
    // Staff cannot manage the team.
    await as('accountant').get(`${base}/team`).expect(403);
    const team = await as('owner').get(`${base}/team`).expect(200);
    expect(team.body.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps financial reports from sales staff', async () => {
    for (const path of [
      'dashboard',
      'reports/profit-loss',
      'reports/balance-sheet',
      'reports/trial-balance',
      'reports/vehicle-profitability',
      'journal',
      'accounts',
      'health',
      'exports/profit-loss',
    ]) {
      await as('sales').get(`${base}/${path}`).expect(403);
      await as('salesManager').get(`${base}/${path}`).expect(403);
    }
    // The deal desk is open to them.
    await as('sales').get(`${base}/customers`).expect(200);
    await as('sales').get(`${base}/vehicles`).expect(200);
    const status = await as('sales').get(`${base}/status`).expect(200);
    expect(status.body.permissions).toEqual(['accounting.sales']);
  });

  it('lets only roles with post_sales post deposits and sales, and hides cost from sales staff', async () => {
    const vehicleId = await createVehicle(prisma, users.owner);
    const bank = (await as('owner').get(`${base}/bank-accounts`).expect(200)).body.find(
      (account: { type: string }) => account.type === 'CHEQUING',
    );
    await as('owner')
      .post(`${base}/acquisitions`)
      .send({
        vehicleId,
        method: 'AUCTION',
        date: today,
        purchasePrice: '20000',
        auctionFee: '800',
        transportation: '500',
        reconditioning: '1200',
        settlement: 'PAID',
        bankAccountId: bank.id,
      })
      .expect(201);
    const customer = (
      await as('sales')
        .post(`${base}/customers`)
        .send({ name: 'Casey Buyer', province: 'ON' })
        .expect(201)
    ).body;

    // Sales user: may quote and save a draft, may not post a deposit or the sale.
    const deal = { vehicleId, customerId: customer.id, saleDate: today, salePrice: '28000' };
    const quote = await as('sales').post(`${base}/sales/quote`).send(deal).expect(201);
    expect(quote.body.totalCents).toBe(3_164_000);
    expect(quote.body).not.toHaveProperty('costOfSaleCents');
    expect(quote.body).not.toHaveProperty('grossProfitCents');
    await as('sales')
      .post(`${base}/deposits`)
      .send({
        customerId: customer.id,
        vehicleId,
        amount: '1000',
        date: today,
        method: 'CASH',
        bankAccountId: bank.id,
      })
      .expect(403);
    await as('sales').post(`${base}/sales`).send(deal).expect(403);
    const draft = await as('sales').post(`${base}/sales/drafts`).send(deal).expect(201);

    // Sales manager posts the draft.
    await as('salesManager').post(`${base}/sales/drafts/${draft.body.id}/post`).expect(201);

    // The owner sees the profit: $28,000 − $22,500 = $5,500, from the ledger.
    const profit = await as('owner').get(`${base}/reports/vehicle-profitability`).expect(200);
    const row = profit.body.rows.find(
      (candidate: { vehicleId: string }) => candidate.vehicleId === vehicleId,
    );
    expect(row.grossProfitCents).toBe(550_000);
    // Sales staff cannot reverse a sale.
    await as('salesManager')
      .post(`${base}/sales/${draft.body.id}/reverse`)
      .send({ reason: 'Test' })
      .expect(403);
  });

  it('produces balanced statements for the accountant', async () => {
    const tb = await as('accountant')
      .get(`${base}/reports/trial-balance`)
      .query({ preset: 'YEAR_TO_DATE' })
      .expect(200);
    expect(tb.body.balanced).toBe(true);
    expect(tb.body.totals.debitCents).toBe(tb.body.totals.creditCents);
    const bs = await as('accountant').get(`${base}/reports/balance-sheet`).expect(200);
    expect(bs.body.balanced).toBe(true);
    const cf = await as('accountant')
      .get(`${base}/reports/cash-flow`)
      .query({ preset: 'YEAR_TO_DATE' })
      .expect(200);
    expect(cf.body.reconciles).toBe(true);
    const pl = await as('accountant')
      .get(`${base}/reports/profit-loss`)
      .query({ preset: 'YEAR_TO_DATE' })
      .expect(200);
    expect(pl.body.grossProfitCents).toBe(550_000);
    const health = await as('accountant').get(`${base}/health`).expect(200);
    expect(
      health.body.findings.filter(
        (finding: { code: string }) => finding.code === 'UNBALANCED_JOURNAL',
      ),
    ).toHaveLength(0);
  });

  it('exports reports as CSV, Excel and PDF', async () => {
    const csv = await as('accountant')
      .get(`${base}/exports/trial-balance`)
      .query({ format: 'csv', preset: 'YEAR_TO_DATE' })
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toMatch(
      /attachment; filename="trial-balance-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(csv.text).toContain('Trial balance');

    const xlsx = await as('accountant')
      .get(`${base}/exports/profit-loss`)
      .query({ format: 'xlsx' })
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');

    const pdf = await as('accountant')
      .get(`${base}/exports/vehicle-profitability`)
      .query({ format: 'pdf' })
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    await as('accountant').get(`${base}/exports/not-a-report`).expect(400);
  });

  it('rejects an unbalanced journal entry', async () => {
    const accounts = (await as('accountant').get(`${base}/accounts`).expect(200)).body as Array<{
      id: string;
      code: string;
    }>;
    const cash = accounts.find((account) => account.code === '1000')!;
    const equity = accounts.find((account) => account.code.startsWith('3'))!;
    await as('accountant')
      .post(`${base}/journal`)
      .send({
        date: today,
        description: 'Unbalanced',
        post: true,
        lines: [
          { accountId: cash.id, debit: '100', credit: '0' },
          { accountId: equity.id, debit: '0', credit: '99' },
        ],
      })
      .expect(400);
  });

  it('isolates dealerships from each other', async () => {
    // Another dealer cannot choose this dealership…
    await as('otherOwner').get(`${base}/dashboard`).set('x-dealer-id', dealerId).expect(403);
    // …nor read its records by id.
    const entries = (
      await as('owner').get(`${base}/journal`).query({ preset: 'YEAR_TO_DATE' }).expect(200)
    ).body.items as Array<{ id: string }>;
    expect(entries.length).toBeGreaterThan(0);
    await as('otherOwner').get(`${base}/journal/${entries[0]!.id}`).expect(404);
    const theirs = (
      await as('otherOwner').get(`${base}/journal`).query({ preset: 'YEAR_TO_DATE' }).expect(200)
    ).body.items as Array<{ id: string }>;
    expect(theirs.map((entry) => entry.id)).not.toContain(entries[0]!.id);
    // The other dealer's chart of accounts is its own.
    const otherAccounts = (await as('otherOwner').get(`${base}/accounts`).expect(200))
      .body as Array<{ id: string }>;
    const ourAccounts = (await as('owner').get(`${base}/accounts`).expect(200)).body as Array<{
      id: string;
    }>;
    expect(
      otherAccounts.some((account) => ourAccounts.some((ours) => ours.id === account.id)),
    ).toBe(false);
    expect(otherDealerId).not.toBe(dealerId);
  });

  it('gives platform admins and strangers no access to dealer books', async () => {
    await as('admin').get(`${base}/dashboard`).expect(403);
    await as('superAdmin').get(`${base}/dashboard`).expect(403);
    await as('stranger').get(`${base}/dashboard`).expect(403);
    await as('stranger').get(`${base}/status`).expect(403);
    // The platform's default tax rules are maintained under settings:manage.
    const rules = await as('superAdmin').get('/admin/accounting/tax-rules').expect(200);
    expect(rules.body.rules.length).toBeGreaterThan(10);
    await as('owner').get('/admin/accounting/tax-rules').expect(403);
    await as('admin').get('/admin/accounting/tax-rules').expect(403);
  });
});

function binary(res: request.Response, callback: (error: Error | null, body: Buffer) => void) {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}
