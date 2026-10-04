import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { journalCreateSchema } from '@vintrax/shared';
import {
  accountByCode,
  accountId,
  closeTestPrisma,
  createDealer,
  createVehicle,
  describeDb,
  setUpAccounting,
  testPrisma,
  type TestDealer,
} from '../testing/harness';
import { todayIso } from '../core/dates';
import { toCents } from '../core/money';
import { accountTotals, debitBalance } from '../reports/ledger';
import { PeriodsService } from '../periods/periods.service';
import { JournalService } from './journal.service';
import { PostingService } from './posting.service';

/** The double-entry engine and the database rules behind it. */
describeDb('double-entry journal', () => {
  const prisma = testPrisma();
  const posting = new PostingService();
  const journal = new JournalService(prisma, posting);
  const periods = new PeriodsService(prisma, posting);
  let dealer: TestDealer;
  let cash: string;
  let rent: string;

  beforeAll(async () => {
    dealer = await createDealer(prisma);
    await setUpAccounting(prisma, dealer);
    cash = await accountId(prisma, dealer.dealerId, 'CASH');
    rent = await accountByCode(prisma, dealer.dealerId, '6100');
  });

  afterAll(closeTestPrisma);

  const entry = (
    lines: Array<{ accountId: string; debit?: string; credit?: string }>,
    date = todayIso(),
  ) =>
    journalCreateSchema.parse({
      date,
      description: 'Test entry',
      lines: lines.map((line) => ({
        accountId: line.accountId,
        debit: line.debit ?? '',
        credit: line.credit ?? '',
      })),
      post: true,
    });

  it('sets up a Canadian dealership chart, a fiscal year and an opening balance', async () => {
    const accounts = await prisma.acctAccount.count({ where: { dealerId: dealer.dealerId } });
    expect(accounts).toBeGreaterThanOrEqual(70);
    const year = await prisma.fiscalYear.findFirst({
      where: { dealerId: dealer.dealerId },
      include: { periods: true },
    });
    expect(year?.periods).toHaveLength(12);

    const chequing = await prisma.bankAccount.findFirstOrThrow({
      where: { dealerId: dealer.dealerId, type: 'CHEQUING' },
    });
    expect(chequing.accountNumberLast4).toBe('4321');
    const totals = await accountTotals(prisma, dealer.dealerId);
    expect(debitBalance(totals.get(chequing.glAccountId))).toBe(5_000_000);
    const equity = await accountId(prisma, dealer.dealerId, 'OWNER_EQUITY');
    expect(debitBalance(totals.get(equity))).toBe(-5_000_000);
  });

  it('posts a balanced entry and keeps the trial balance in balance', async () => {
    await journal.create(
      dealer.ctx,
      entry([
        { accountId: rent, debit: '1500.00' },
        { accountId: cash, credit: '1500' },
      ]),
    );
    const totals = await accountTotals(prisma, dealer.dealerId);
    let debits = 0;
    let credits = 0;
    for (const row of totals.values()) {
      debits += row.debitCents;
      credits += row.creditCents;
    }
    expect(debits).toBe(credits);
    expect(debitBalance(totals.get(rent))).toBe(150_000);
  });

  it('refuses an unbalanced entry before it reaches the database', async () => {
    expect(() =>
      journalCreateSchema.parse({
        date: todayIso(),
        description: 'x',
        lines: [
          { accountId: rent, debit: '100' },
          { accountId: cash, credit: '99.99' },
        ],
      }),
    ).toThrow(/Debits must equal credits/);

    await expect(
      prisma.$transaction((tx) =>
        posting.post(tx, dealer.ctx, {
          date: todayIso(),
          description: 'Unbalanced',
          source: 'MANUAL',
          lines: [
            { accountId: rent, debit: 10_000, credit: 0 },
            { accountId: cash, debit: 0, credit: 9_999 },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a zero transaction', async () => {
    await expect(
      prisma.$transaction((tx) =>
        posting.post(tx, dealer.ctx, {
          date: todayIso(),
          description: 'Nothing',
          source: 'MANUAL',
          lines: [
            { accountId: rent, debit: 0, credit: 0 },
            { accountId: cash, debit: 0, credit: 0 },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('has the database reject an unbalanced posted entry even if the API were wrong', async () => {
    const id = crypto.randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "JournalEntry" ("id","dealerId","number","reference","date","description","source","kind","status","total","createdAt","updatedAt")
          VALUES (${id}::uuid, ${dealer.dealerId}::uuid, 999999, 'RAW-1', CURRENT_DATE, 'raw', 'MANUAL', 'STANDARD', 'POSTED', 100, NOW(), NOW())`;
        await tx.$executeRaw`INSERT INTO "JournalLine" ("id","entryId","dealerId","lineNo","accountId","debit","credit")
          VALUES (gen_random_uuid(), ${id}::uuid, ${dealer.dealerId}::uuid, 1, ${rent}::uuid, 100, 0),
                 (gen_random_uuid(), ${id}::uuid, ${dealer.dealerId}::uuid, 2, ${cash}::uuid, 0, 90)`;
      }),
    ).rejects.toThrow(/unbalanced/);
  });

  it('never lets a posted entry or its lines be changed or deleted', async () => {
    const { id } = await journal.create(
      dealer.ctx,
      entry([
        { accountId: rent, debit: '10' },
        { accountId: cash, credit: '10' },
      ]),
    );
    await expect(
      prisma.$executeRaw`UPDATE "JournalLine" SET "debit" = 20 WHERE "entryId" = ${id}::uuid AND "debit" > 0`,
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      prisma.$executeRaw`DELETE FROM "JournalLine" WHERE "entryId" = ${id}::uuid`,
    ).rejects.toThrow(/cannot be deleted/);
    await expect(
      prisma.$executeRaw`DELETE FROM "JournalEntry" WHERE "id" = ${id}::uuid`,
    ).rejects.toThrow(/cannot be deleted/);
    await expect(
      prisma.$executeRaw`UPDATE "JournalEntry" SET "total" = 1 WHERE "id" = ${id}::uuid`,
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      prisma.$executeRaw`INSERT INTO "JournalLine" ("id","entryId","dealerId","lineNo","accountId","debit","credit")
        VALUES (gen_random_uuid(), ${id}::uuid, ${dealer.dealerId}::uuid, 9, ${rent}::uuid, 1, 0)`,
    ).rejects.toThrow(/posted journal entry/);
    await expect(journal.deleteDraft(dealer.ctx, id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('reverses an entry with its mirror image, once', async () => {
    const { id } = await journal.create(
      dealer.ctx,
      entry([
        { accountId: rent, debit: '250' },
        { accountId: cash, credit: '250' },
      ]),
    );
    const before = debitBalance((await accountTotals(prisma, dealer.dealerId)).get(rent));
    const reversal = await journal.reverse(dealer.ctx, id, { reason: 'Entered twice' });
    const after = debitBalance((await accountTotals(prisma, dealer.dealerId)).get(rent));
    expect(before - after).toBe(25_000);

    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id } });
    expect(original.reversedAt).not.toBeNull();
    const mirror = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: reversal.id },
      include: { lines: true },
    });
    expect(mirror.reversalOfId).toBe(id);
    expect(mirror.kind).toBe('REVERSAL');
    await expect(journal.reverse(dealer.ctx, id, { reason: 'again' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      journal.reverse(dealer.ctx, reversal.id, { reason: 'again' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps drafts off the books until they are posted', async () => {
    const draft = await journal.create(dealer.ctx, {
      ...entry([
        { accountId: rent, debit: '5' },
        { accountId: cash, credit: '5' },
      ]),
      post: false,
    });
    const before = debitBalance((await accountTotals(prisma, dealer.dealerId)).get(rent));
    await journal.postDraft(dealer.ctx, draft.id);
    const after = debitBalance((await accountTotals(prisma, dealer.dealerId)).get(rent));
    expect(after - before).toBe(500);

    const another = await journal.create(dealer.ctx, {
      ...entry([
        { accountId: rent, debit: '5' },
        { accountId: cash, credit: '5' },
      ]),
      post: false,
    });
    await journal.deleteDraft(dealer.ctx, another.id);
    expect(await prisma.journalEntry.findUnique({ where: { id: another.id } })).toBeNull();
  });

  it('refuses to post into a closed period, in the API and in the database', async () => {
    const other = await createDealer(prisma);
    await setUpAccounting(prisma, other, { openingBank: undefined });
    const otherCash = await accountId(prisma, other.dealerId, 'CASH');
    const otherRent = await accountByCode(prisma, other.dealerId, '6100');
    const year = await prisma.fiscalYear.findFirstOrThrow({
      where: { dealerId: other.dealerId },
      include: { periods: { orderBy: { number: 'asc' } } },
    });
    const first = year.periods[0]!;
    const date = first.startDate.toISOString().slice(0, 10);
    await periods.closePeriod(other.ctx, first.id, 'Month end');

    await expect(
      journal.create(other.ctx, {
        ...entry(
          [
            { accountId: otherRent, debit: '1' },
            { accountId: otherCash, credit: '1' },
          ],
          date,
        ),
      }),
    ).rejects.toThrow(/closed/);

    await expect(
      prisma.$executeRaw`INSERT INTO "JournalEntry" ("id","dealerId","number","reference","date","description","source","kind","status","total","createdAt","updatedAt")
        VALUES (gen_random_uuid(), ${other.dealerId}::uuid, 888888, 'RAW-2', ${first.startDate}, 'raw', 'MANUAL', 'STANDARD', 'POSTED', 0, NOW(), NOW())`,
    ).rejects.toThrow(/closed/);

    await periods.reopenPeriod(other.ctx, first.id, 'Late invoice');
    await expect(
      journal.create(
        other.ctx,
        entry(
          [
            { accountId: otherRent, debit: '1' },
            { accountId: otherCash, credit: '1' },
          ],
          date,
        ),
      ),
    ).resolves.toBeDefined();
  });

  it('keeps one dealer out of another dealer’s accounts and vehicles', async () => {
    const rival = await createDealer(prisma, 'Rival Autos');
    await setUpAccounting(prisma, rival, { openingBank: undefined });
    const rivalCash = await accountId(prisma, rival.dealerId, 'CASH');
    const theirVehicle = await createVehicle(prisma, dealer.ownerId);

    await expect(
      journal.create(
        rival.ctx,
        entry([
          { accountId: rent, debit: '1' },
          { accountId: rivalCash, credit: '1' },
        ]),
      ),
    ).rejects.toThrow(/does not exist in this chart/);

    const rivalRent = await accountByCode(prisma, rival.dealerId, '6100');
    await expect(
      prisma.$transaction((tx) =>
        posting.post(tx, rival.ctx, {
          date: todayIso(),
          description: 'Someone else’s car',
          source: 'MANUAL',
          lines: [
            { accountId: rivalRent, debit: 100, credit: 0, vehicleId: theirVehicle },
            { accountId: rivalCash, debit: 0, credit: 100 },
          ],
        }),
      ),
    ).rejects.toThrow(/Vehicle not found/);

    const list = await journal.list(rival.ctx, {
      page: 1,
      pageSize: 200,
      compare: 'NONE',
      profitability: 'ALL',
    } as never);
    expect(list.items.every((item) => item.id)).toBe(true);
    const mine = await prisma.journalEntry.findMany({
      where: { dealerId: dealer.dealerId },
      select: { id: true },
    });
    expect(list.items.some((item) => mine.some((row) => row.id === item.id))).toBe(false);
  });

  it('keeps the accounting audit trail append-only', async () => {
    const row = await prisma.accountingAuditLog.findFirstOrThrow({
      where: { dealerId: dealer.dealerId },
    });
    await expect(
      prisma.$executeRaw`UPDATE "AccountingAuditLog" SET "action" = 'x' WHERE "id" = ${row.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRaw`DELETE FROM "AccountingAuditLog" WHERE "id" = ${row.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    const posted = await prisma.accountingAuditLog.count({
      where: { dealerId: dealer.dealerId, action: 'journal.posted' },
    });
    expect(posted).toBeGreaterThan(0);
  });

  it('stores money exactly', async () => {
    const { id } = await journal.create(
      dealer.ctx,
      entry([
        { accountId: rent, debit: '0.10' },
        { accountId: rent, debit: '0.20' },
        { accountId: cash, credit: '0.30' },
      ]),
    );
    const saved = await prisma.journalEntry.findUniqueOrThrow({ where: { id } });
    expect(saved.total).toEqual(new Prisma.Decimal('0.30'));
    expect(toCents(saved.total)).toBe(30);
  });
});
