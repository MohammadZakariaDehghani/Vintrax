import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  acquisitionSchema,
  billSchema,
  depositSchema,
  expenseSchema,
  paymentSchema,
  saleSchema,
  tradeInSchema,
  type SaleInput,
} from '@vintrax/shared';
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
} from './testing/harness';
import { accountingServices } from './testing/services';
import { addDays, todayIso } from './core/dates';
import { toCents } from './core/money';
import { accountTotals, debitBalance } from './reports/ledger';

/**
 * Every business flow posts real, balanced double-entry, and the figures the
 * dealer cares about (book value, cost of sales, gross profit, tax by type,
 * customer balances) come out of the ledger.
 */
describeDb('accounting flows', () => {
  const prisma = testPrisma();
  const s = accountingServices(prisma);
  const today = todayIso();
  let dealer: TestDealer;
  let chequing: string;
  let customer: string;

  async function balance(key: string, vehicleId?: string) {
    const id = await accountId(prisma, dealer.dealerId, key);
    const totals = await accountTotals(prisma, dealer.dealerId, { accountIds: [id], vehicleId });
    return debitBalance(totals.get(id));
  }

  async function assertTrialBalance(dealerId = dealer.dealerId) {
    const totals = await accountTotals(prisma, dealerId);
    let debits = 0;
    let credits = 0;
    for (const row of totals.values()) {
      debits += row.debitCents;
      credits += row.creditCents;
    }
    expect(debits).toBe(credits);
  }

  async function buy(vehicleId: string, price: string, extra: Record<string, string> = {}) {
    return s.acquisitions.create(
      dealer.ctx,
      acquisitionSchema.parse({
        vehicleId,
        method: 'AUCTION',
        date: today,
        purchasePrice: price,
        settlement: 'PAID',
        bankAccountId: chequing,
        ...extra,
      }),
    );
  }

  const sale = (vehicleId: string, overrides: Partial<Record<keyof SaleInput, unknown>> = {}) =>
    saleSchema.parse({
      vehicleId,
      customerId: customer,
      saleDate: today,
      salePrice: '28000',
      ...overrides,
    });

  beforeAll(async () => {
    dealer = await createDealer(prisma);
    await setUpAccounting(prisma, dealer);
    chequing = (
      await prisma.bankAccount.findFirstOrThrow({
        where: { dealerId: dealer.dealerId, type: 'CHEQUING' },
      })
    ).id;
    customer = (
      await s.parties.createCustomer(dealer.ctx, {
        name: 'Casey Buyer',
        email: null,
        phone: null,
        address: null,
        city: 'Toronto',
        province: 'ON',
        postalCode: null,
        userId: null,
        notes: null,
      })
    ).id;
  });

  afterAll(closeTestPrisma);

  it('buys a vehicle into inventory at its full landed cost', async () => {
    const vehicle = await createVehicle(prisma, dealer.ownerId);
    const result = await buy(vehicle, '20000', {
      auctionFee: '800',
      transportation: '500',
      reconditioning: '1200',
    });
    expect(result.totalCents).toBe(2_250_000);
    expect(await balance('VEHICLE_INVENTORY', vehicle)).toBe(2_250_000);
    const costs = await prisma.vehicleCost.findMany({ where: { vehicleId: vehicle } });
    expect(costs.map((cost) => cost.amountCents).sort((a, b) => a - b)).toEqual([
      50_000, 80_000, 120_000, 2_000_000,
    ]);
    expect(costs.every((cost) => cost.journalEntryId === result.journalEntryId)).toBe(true);
    await expect(buy(vehicle, '1')).rejects.toBeInstanceOf(ConflictException);
    await assertTrialBalance();
  });

  it('sells it: revenue, HST, cost of sales and gross profit from the ledger', async () => {
    const vehicle = await createVehicle(prisma, dealer.ownerId);
    await buy(vehicle, '20000', {
      auctionFee: '800',
      transportation: '500',
      reconditioning: '1200',
    });
    const hstBefore = await balance('GST_HST_PAYABLE');
    const result = await s.sales.post(
      dealer.ctx,
      sale(vehicle, {
        downPayment: '31640',
        downPaymentMethod: 'BANK_TRANSFER',
        bankAccountId: chequing,
      }),
    );

    expect(result.computation.taxTotalCents).toBe(364_000); // 13 % of $28,000
    expect(result.computation.totalCents).toBe(3_164_000);
    expect(result.computation.costOfSaleCents).toBe(2_250_000);
    expect(result.computation.grossProfitCents).toBe(550_000); // $5,500
    expect(result.computation.balanceDueCents).toBe(0);

    expect(await balance('VEHICLE_INVENTORY', vehicle)).toBe(0);
    expect(await balance('VEHICLE_COGS', vehicle)).toBe(2_250_000);
    expect(await balance('USED_VEHICLE_SALES', vehicle)).toBe(-2_800_000);
    expect((await balance('GST_HST_PAYABLE')) - hstBefore).toBe(-364_000);

    const sold = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle } });
    expect(sold.status).toBe('SOLD');
    const lines = await prisma.taxLine.findMany({ where: { sourceId: result.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.taxType).toBe('HST');
    expect(lines[0]!.rate.toString()).toBe('13');
    await expect(s.sales.post(dealer.ctx, sale(vehicle))).rejects.toBeInstanceOf(ConflictException);
    await assertTrialBalance();
  });

  it('records a loss when a vehicle sells below cost', async () => {
    const vehicle = await createVehicle(prisma, dealer.ownerId);
    await buy(vehicle, '10000');
    const result = await s.sales.post(dealer.ctx, sale(vehicle, { salePrice: '9000' }));
    expect(result.computation.grossProfitCents).toBe(-100_000);
    expect(result.computation.balanceDueCents).toBe(1_017_000); // $9,000 + 13 % HST
    await assertTrialBalance();
  });

  it('refuses to sell a vehicle with no cost on the books', async () => {
    const vehicle = await createVehicle(prisma, dealer.ownerId);
    await expect(s.sales.post(dealer.ctx, sale(vehicle))).rejects.toThrow(/no cost on the books/);
  });

  it('holds a deposit as a liability until it is applied to the sale', async () => {
    const vehicle = await createVehicle(prisma, dealer.ownerId);
    await buy(vehicle, '15000');
    const liabilityBefore = await balance('CUSTOMER_DEPOSITS');
    const deposit = await s.deposits.receive(
      dealer.ctx,
      depositSchema.parse({
        customerId: customer,
        vehicleId: vehicle,
        date: today,
        amount: '1000',
        method: 'E_TRANSFER',
        bankAccountId: chequing,
      }),
    );
    expect((await balance('CUSTOMER_DEPOSITS')) - liabilityBefore).toBe(-100_000);

    const result = await s.sales.post(
      dealer.ctx,
      sale(vehicle, { salePrice: '20000', deposits: [{ depositId: deposit.id, amount: '1000' }] }),
    );
    expect(result.computation.balanceDueCents).toBe(2_260_000 - 100_000);
    expect(await balance('CUSTOMER_DEPOSITS')).toBe(liabilityBefore);
    const saved = await prisma.customerDeposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(saved.status).toBe('APPLIED');
    await expect(
      s.sales.quote(
        dealer.ctx,
        sale(await createVehicle(prisma, dealer.ownerId), {
          deposits: [{ depositId: deposit.id, amount: '1' }],
        }),
      ),
    ).rejects.toThrow(/has only 0.00 left/);
    await assertTrialBalance();
  });

  it('refunds part of a deposit and keeps the rest', async () => {
    const deposit = await s.deposits.receive(
      dealer.ctx,
      depositSchema.parse({
        customerId: customer,
        date: today,
        amount: '500',
        method: 'CASH',
        bankAccountId: chequing,
      }),
    );
    await s.deposits.refund(dealer.ctx, deposit.id, {
      amount: 20_000,
      date: today,
      bankAccountId: chequing,
      reason: 'Changed vehicle',
    });
    const saved = await prisma.customerDeposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(toCents(saved.refunded)).toBe(20_000);
    expect(saved.status).toBe('OPEN');
    await expect(
      s.deposits.refund(dealer.ctx, deposit.id, {
        amount: 40_000,
        date: today,
        bankAccountId: chequing,
        reason: 'Too much',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await assertTrialBalance();
  });

  it('brings a trade-in into inventory at actual cash value, with its loan payoff owed', async () => {
    const lien = await s.parties.createVendor(dealer.ctx, {
      name: 'Maple Auto Finance',
      kind: 'LENDER',
      email: null,
      phone: null,
      address: null,
      province: 'ON',
      gstNumber: null,
      paymentTermsDays: 10,
      notes: null,
    });
    const vehicle = await createVehicle(prisma, dealer.ownerId);
    await buy(vehicle, '15000');
    const tradeIn = await s.tradeIns.create(
      dealer.ctx,
      tradeInSchema.parse({
        customerId: customer,
        year: 2015,
        make: 'Toyota',
        model: 'Corolla',
        mileageKm: 140000,
        appraisedValue: '8000',
        tradeAllowance: '9000',
        lienPayoff: '3000',
        lienHolderVendorId: lien.id,
      }),
    );
    const apBefore = await balance('AP');
    const result = await s.sales.post(
      dealer.ctx,
      sale(vehicle, { salePrice: '20000', tradeInId: tradeIn.id }),
    );

    // HST on $20,000 less the $9,000 allowance.
    expect(result.computation.taxTotalCents).toBe(143_000);
    // $21,430 − $9,000 allowance + $3,000 payoff.
    expect(result.computation.balanceDueCents).toBe(1_543_000);
    // Inventory at $8,000 (actual cash value); the $1,000 over-allowance reduces this sale's revenue.
    expect(await balance('VEHICLE_INVENTORY', tradeIn.vehicleId)).toBe(800_000);
    expect(result.computation.overAllowanceCents).toBe(100_000);
    expect(result.computation.grossProfitCents).toBe(2_000_000 - 100_000 - 1_500_000);
    expect((await balance('AP')) - apBefore).toBe(-300_000);

    const saved = await prisma.tradeIn.findUniqueOrThrow({ where: { id: tradeIn.id } });
    expect(saved.status).toBe('POSTED');
    const acquisition = await prisma.vehicleAcquisition.findFirstOrThrow({
      where: { vehicleId: tradeIn.vehicleId },
    });
    expect(acquisition.method).toBe('TRADE_IN');
    expect(toCents(acquisition.total)).toBe(800_000);
    await assertTrialBalance();
  });

  it('takes partial payments on an invoice until it is paid, and reverses one', async () => {
    const vehicle = await createVehicle(prisma, dealer.ownerId);
    await buy(vehicle, '5000');
    const result = await s.sales.post(dealer.ctx, sale(vehicle, { salePrice: '6000' }));
    const invoice = await prisma.customerInvoice.findFirstOrThrow({ where: { saleId: result.id } });
    expect(toCents(invoice.total)).toBe(678_000);

    const pay = (amount: string) =>
      s.payments.create(
        dealer.ctx,
        paymentSchema.parse({
          direction: 'RECEIVED',
          customerId: customer,
          date: today,
          amount,
          method: 'DEBIT',
          bankAccountId: chequing,
          allocations: [{ invoiceId: invoice.id, amount }],
        }),
      );
    const first = await pay('2000');
    expect(
      (await prisma.customerInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
    ).toBe('PARTIAL');
    await expect(pay('5000')).rejects.toThrow(/only 4780.00 open/);
    await pay('4780');
    expect(
      (await prisma.customerInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
    ).toBe('PAID');

    await s.payments.reverse(dealer.ctx, first.id, 'Cheque bounced');
    const after = await prisma.customerInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(after.status).toBe('PARTIAL');
    expect(toCents(after.amountPaid)).toBe(478_000);
    await expect(s.sales.reverse(dealer.ctx, result.id, 'x')).rejects.toThrow(/reverse them first/);
    await assertTrialBalance();
  });

  it('refuses a full card number as a payment reference', () => {
    expect(() =>
      paymentSchema.parse({
        direction: 'RECEIVED',
        customerId: customer,
        date: today,
        amount: '10',
        method: 'CREDIT_CARD',
        reference: '4111 1111 1111 1111',
        bankAccountId: chequing,
      }),
    ).toThrow(/last four digits/);
  });

  it('reverses a sale completely', async () => {
    const vehicle = await createVehicle(prisma, dealer.ownerId);
    await buy(vehicle, '7000');
    const deposit = await s.deposits.receive(
      dealer.ctx,
      depositSchema.parse({
        customerId: customer,
        date: today,
        amount: '300',
        method: 'CASH',
        bankAccountId: chequing,
      }),
    );
    const result = await s.sales.post(
      dealer.ctx,
      sale(vehicle, { salePrice: '9000', deposits: [{ depositId: deposit.id, amount: '300' }] }),
    );
    await s.sales.reverse(dealer.ctx, result.id, 'Customer backed out');

    expect(await balance('VEHICLE_INVENTORY', vehicle)).toBe(700_000);
    expect(await balance('VEHICLE_COGS', vehicle)).toBe(0);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle } })).status).toBe(
      'ACTIVE',
    );
    const taxLines = await prisma.taxLine.findMany({ where: { sourceId: result.id } });
    expect(taxLines.reduce((sum, line) => sum + toCents(line.amount), 0)).toBe(0);
    expect(
      (await prisma.customerDeposit.findUniqueOrThrow({ where: { id: deposit.id } })).status,
    ).toBe('OPEN');
    expect((await prisma.vehicleSale.findUniqueOrThrow({ where: { id: result.id } })).status).toBe(
      'VOID',
    );
    // And it can be sold again.
    await expect(
      s.sales.post(dealer.ctx, sale(vehicle, { salePrice: '9500' })),
    ).resolves.toBeDefined();
    await assertTrialBalance();
  });

  it('posts vendor bills with recoverable HST, pays them in part, and applies a credit', async () => {
    const vendor = await s.parties.createVendor(dealer.ctx, {
      name: 'Landlord Inc.',
      kind: 'SERVICE',
      email: null,
      phone: null,
      address: null,
      province: 'ON',
      gstNumber: null,
      paymentTermsDays: 30,
      notes: null,
    });
    const rent = await accountByCode(prisma, dealer.dealerId, '6100');
    const recoverableBefore = await balance('GST_HST_RECOVERABLE');
    const bill = await s.bills.create(
      dealer.ctx,
      billSchema.parse({
        vendorId: vendor.id,
        date: today,
        dueDate: addDays(today, 30),
        lines: [{ accountId: rent, description: 'Rent', amount: '1000' }],
      }),
    );
    expect(bill.totalCents).toBe(113_000);
    expect((await balance('GST_HST_RECOVERABLE')) - recoverableBefore).toBe(13_000);

    await s.payments.create(
      dealer.ctx,
      paymentSchema.parse({
        direction: 'SENT',
        vendorId: vendor.id,
        date: today,
        amount: '500',
        method: 'CHEQUE',
        reference: '1042',
        bankAccountId: chequing,
        allocations: [{ billId: bill.id, amount: '500' }],
      }),
    );
    expect((await prisma.vendorBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe(
      'PARTIAL',
    );

    const credit = await s.bills.create(
      dealer.ctx,
      billSchema.parse({
        vendorId: vendor.id,
        kind: 'CREDIT_NOTE',
        date: today,
        dueDate: today,
        lines: [{ accountId: rent, description: 'Rent credit', amount: '100' }],
      }),
    );
    await s.bills.applyCredit(dealer.ctx, credit.id, bill.id, 11_300);
    await s.payments.create(
      dealer.ctx,
      paymentSchema.parse({
        direction: 'SENT',
        vendorId: vendor.id,
        date: today,
        amount: '517',
        method: 'CHEQUE',
        bankAccountId: chequing,
        allocations: [{ billId: bill.id, amount: '517' }],
      }),
    );
    expect((await prisma.vendorBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe(
      'PAID',
    );
    await assertTrialBalance();
  });

  it('adds a vehicle direct cost to book value, and books an operating expense with its HST', async () => {
    const vehicle = await createVehicle(prisma, dealer.ownerId);
    await buy(vehicle, '12000');
    const detailing = await accountByCode(prisma, dealer.dealerId, '6530');
    await s.expenses.create(
      dealer.ctx,
      expenseSchema.parse({
        date: today,
        accountId: detailing,
        treatment: 'VEHICLE_COST',
        vehicleId: vehicle,
        costCategory: 'DETAILING',
        description: 'Full detail',
        amount: '300',
        method: 'DEBIT',
        bankAccountId: chequing,
      }),
    );
    expect(await balance('VEHICLE_INVENTORY', vehicle)).toBe(1_230_000);

    const advertising = await accountId(prisma, dealer.dealerId, 'ADVERTISING');
    const before = await balance('GST_HST_RECOVERABLE');
    const expense = await s.expenses.create(
      dealer.ctx,
      expenseSchema.parse({
        date: today,
        accountId: advertising,
        description: 'AutoTrader listing',
        amount: '200',
        applyTax: true,
        method: 'CREDIT_CARD',
        bankAccountId: chequing,
      }),
    );
    expect(expense.totalCents).toBe(22_600);
    expect((await balance('GST_HST_RECOVERABLE')) - before).toBe(2_600);

    // The vehicle sells: its cost of sale includes the detailing.
    const result = await s.sales.post(dealer.ctx, sale(vehicle, { salePrice: '14000' }));
    expect(result.computation.costOfSaleCents).toBe(1_230_000);
    await expect(
      s.expenses.create(
        dealer.ctx,
        expenseSchema.parse({
          date: today,
          accountId: advertising,
          treatment: 'CAPITAL',
          description: 'x',
          amount: '1',
          method: 'CASH',
          bankAccountId: chequing,
        }),
      ),
    ).rejects.toThrow(/fixed-asset/);
    await assertTrialBalance();
  });

  it('keeps each tax rate a transaction was posted with, after the rate changes', async () => {
    const other = await createDealer(prisma, 'Rate Change Motors');
    await setUpAccounting(prisma, other);
    const bank = (
      await prisma.bankAccount.findFirstOrThrow({
        where: { dealerId: other.dealerId, type: 'CHEQUING' },
      })
    ).id;
    const buyer = (
      await s.parties.createCustomer(other.ctx, {
        name: 'Rae',
        email: null,
        phone: null,
        address: null,
        city: null,
        province: null,
        postalCode: null,
        userId: null,
        notes: null,
      })
    ).id;
    const hst = await prisma.taxRule.findFirstOrThrow({
      where: { dealerId: null, province: 'ON', taxType: 'HST' },
    });

    const first = await createVehicle(prisma, other.ownerId);
    await s.acquisitions.create(
      other.ctx,
      acquisitionSchema.parse({
        vehicleId: first,
        method: 'DEALER',
        date: today,
        purchasePrice: '1000',
        settlement: 'PAID',
        bankAccountId: bank,
      }),
    );
    const before = await s.sales.post(
      other.ctx,
      saleSchema.parse({
        vehicleId: first,
        customerId: buyer,
        saleDate: today,
        salePrice: '10000',
      }),
    );

    const tomorrow = addDays(today, 1);
    await s.tax.supersedeRule(other.ctx, hst.id, {
      rate: '15',
      effectiveFrom: tomorrow,
      source: 'Test change',
      notes: null,
    });

    const second = await createVehicle(prisma, other.ownerId);
    await s.acquisitions.create(
      other.ctx,
      acquisitionSchema.parse({
        vehicleId: second,
        method: 'DEALER',
        date: today,
        purchasePrice: '1000',
        settlement: 'PAID',
        bankAccountId: bank,
      }),
    );
    const after = await s.sales.post(
      other.ctx,
      saleSchema.parse({
        vehicleId: second,
        customerId: buyer,
        saleDate: tomorrow,
        salePrice: '10000',
      }),
    );

    expect(before.computation.taxTotalCents).toBe(130_000);
    expect(after.computation.taxTotalCents).toBe(150_000);
    const old = await prisma.taxLine.findFirstOrThrow({ where: { sourceId: before.id } });
    expect(old.rate.toString()).toBe('13');
    // Another dealer is unaffected by this dealer's own rule.
    const quote = await s.tax.quote(dealer.ctx, {
      province: 'ON',
      date: tomorrow,
      lines: [{ category: 'VEHICLE', amount: 1_000_000 }],
      tradeIn: 0,
      vehiclePrice: 0,
    });
    expect(quote.totalTaxCents).toBe(130_000);
  });

  it('charges GST and QST separately in Quebec, each to its own account', async () => {
    const qc = await createDealer(prisma, 'Garage Québec');
    await setUpAccounting(prisma, qc, { province: 'QC' });
    const bank = (
      await prisma.bankAccount.findFirstOrThrow({
        where: { dealerId: qc.dealerId, type: 'CHEQUING' },
      })
    ).id;
    const buyer = (
      await s.parties.createCustomer(qc.ctx, {
        name: 'Camille',
        email: null,
        phone: null,
        address: null,
        city: null,
        province: 'QC',
        postalCode: null,
        userId: null,
        notes: null,
      })
    ).id;
    const vehicle = await createVehicle(prisma, qc.ownerId);
    await s.acquisitions.create(
      qc.ctx,
      acquisitionSchema.parse({
        vehicleId: vehicle,
        method: 'DEALER',
        date: today,
        purchasePrice: '15000',
        settlement: 'PAID',
        bankAccountId: bank,
      }),
    );
    const result = await s.sales.post(
      qc.ctx,
      saleSchema.parse({
        vehicleId: vehicle,
        customerId: buyer,
        saleDate: today,
        salePrice: '20000',
      }),
    );
    const types = result.computation.tax.components.map((c) => [c.taxType, c.taxCents]);
    expect(types).toEqual(
      expect.arrayContaining([
        ['GST', 100_000],
        ['QST', 199_500],
      ]),
    );
    const gst = await accountId(prisma, qc.dealerId, 'GST_HST_PAYABLE');
    const qst = await accountId(prisma, qc.dealerId, 'QST_PAYABLE');
    const totals = await accountTotals(prisma, qc.dealerId, { accountIds: [gst, qst] });
    expect(debitBalance(totals.get(gst))).toBe(-100_000);
    expect(debitBalance(totals.get(qst))).toBe(-199_500);
    await assertTrialBalance(qc.dealerId);
  });

  it('reconciles the bank, refusing to complete while a difference remains', async () => {
    const recs = await s.banking.reconciliations(dealer.ctx, chequing);
    expect(recs).toHaveLength(0);
    const bank = (await s.banking.accounts(dealer.ctx)).find((account) => account.id === chequing)!;

    const started = await s.banking.startReconciliation(dealer.ctx, {
      bankAccountId: chequing,
      statementDate: today,
      endingBalance: bank.balanceCents + 1_500,
    });
    const view = await s.banking.reconciliation(dealer.ctx, started.id);
    const cleared = await s.banking.setCleared(
      dealer.ctx,
      started.id,
      view.items.map((item) => item.lineId),
    );
    expect(cleared.clearedBalanceCents).toBe(bank.balanceCents);
    expect(cleared.differenceCents).toBe(1_500);

    await expect(s.banking.completeReconciliation(dealer.ctx, started.id, null)).rejects.toThrow(
      /differ by 15.00/,
    );
    const interest = await accountByCode(prisma, dealer.dealerId, '4950');
    const done = await s.banking.completeReconciliation(dealer.ctx, started.id, {
      accountId: interest,
      reason: 'Bank interest earned',
    });
    expect(done.adjustmentEntryId).not.toBeNull();
    const audit = await prisma.accountingAuditLog.findFirstOrThrow({
      where: { entityId: started.id, action: 'reconciliation.completed' },
    });
    expect(audit.reason).toBe('Bank interest earned');
    const final = await s.banking.reconciliation(dealer.ctx, started.id);
    expect(final.status).toBe('COMPLETED');
    expect(final.differenceCents).toBe(0);
    await assertTrialBalance();
  });

  it('finances a purchase on the floor plan and pays it off', async () => {
    const lender = await s.parties.createVendor(dealer.ctx, {
      name: 'NextGear Capital',
      kind: 'LENDER',
      email: null,
      phone: null,
      address: null,
      province: null,
      gstNumber: null,
      paymentTermsDays: 0,
      notes: null,
    });
    const vehicle = await createVehicle(prisma, dealer.ownerId);
    const floorBefore = await balance('FLOOR_PLAN');
    const result = await s.acquisitions.create(
      dealer.ctx,
      acquisitionSchema.parse({
        vehicleId: vehicle,
        method: 'AUCTION',
        date: today,
        purchasePrice: '18000',
        settlement: 'FLOOR_PLAN',
        floorPlan: { lenderVendorId: lender.id, interestRate: '7.5' },
      }),
    );
    expect((await balance('FLOOR_PLAN')) - floorBefore).toBe(-1_800_000);
    await s.floorPlan.pay(dealer.ctx, result.floorPlanNoteId!, {
      kind: 'INTEREST_PAYMENT',
      date: today,
      principal: 0,
      interest: 11_250,
      bankAccountId: chequing,
    });
    await s.floorPlan.pay(dealer.ctx, result.floorPlanNoteId!, {
      kind: 'PAYOFF',
      date: today,
      principal: 0,
      interest: 0,
      bankAccountId: chequing,
    });
    const note = await prisma.floorPlanNote.findUniqueOrThrow({
      where: { id: result.floorPlanNoteId! },
    });
    expect(note.status).toBe('PAID_OFF');
    expect(await balance('FLOOR_PLAN')).toBe(floorBefore);
    expect(await balance('INTEREST_EXPENSE', vehicle)).toBe(11_250);
    await assertTrialBalance();
  });

  it('keeps every flow inside its own dealership', async () => {
    const rival = await createDealer(prisma, 'Rival Autos');
    await setUpAccounting(prisma, rival);
    const rivalBank = (
      await prisma.bankAccount.findFirstOrThrow({
        where: { dealerId: rival.dealerId, type: 'CHEQUING' },
      })
    ).id;
    const myVehicle = await createVehicle(prisma, dealer.ownerId);

    await expect(
      s.acquisitions.create(
        rival.ctx,
        acquisitionSchema.parse({
          vehicleId: myVehicle,
          method: 'AUCTION',
          date: today,
          purchasePrice: '1',
          settlement: 'PAID',
          bankAccountId: rivalBank,
        }),
      ),
    ).rejects.toThrow(/not found in your inventory/);
    await expect(
      s.deposits.receive(
        rival.ctx,
        depositSchema.parse({
          customerId: customer,
          date: today,
          amount: '1',
          method: 'CASH',
          bankAccountId: rivalBank,
        }),
      ),
    ).rejects.toThrow(/Customer not found/);
    await expect(
      s.deposits.receive(
        dealer.ctx,
        depositSchema.parse({
          customerId: customer,
          date: today,
          amount: '1',
          method: 'CASH',
          bankAccountId: rivalBank,
        }),
      ),
    ).rejects.toThrow(/Bank account not found/);
    const customers = await s.parties.customers(rival.ctx, { page: 1, pageSize: 50 });
    expect(customers.items.some((row) => row.id === customer)).toBe(false);
  });

  it('closes a year into retained earnings and reopens it', async () => {
    const closer = await createDealer(prisma, 'Year End Motors');
    await setUpAccounting(prisma, closer, { openingBank: undefined });
    const cash = await accountId(prisma, closer.dealerId, 'CASH');
    const revenue = await accountId(prisma, closer.dealerId, 'OTHER_REVENUE');
    const rent = await accountByCode(prisma, closer.dealerId, '6100');
    const lastYearDate = `${Number(today.slice(0, 4)) - 1}-06-15`;
    await s.journal.create(closer.ctx, {
      date: lastYearDate,
      description: 'Revenue',
      memo: null,
      kind: 'STANDARD',
      post: true,
      lines: [
        {
          accountId: cash,
          debit: 500_000,
          credit: 0,
          description: null,
          vehicleId: null,
          customerId: null,
          vendorId: null,
        },
        {
          accountId: revenue,
          debit: 0,
          credit: 500_000,
          description: null,
          vehicleId: null,
          customerId: null,
          vendorId: null,
        },
      ],
    });
    await s.journal.create(closer.ctx, {
      date: lastYearDate,
      description: 'Rent',
      memo: null,
      kind: 'STANDARD',
      post: true,
      lines: [
        {
          accountId: rent,
          debit: 120_000,
          credit: 0,
          description: null,
          vehicleId: null,
          customerId: null,
          vendorId: null,
        },
        {
          accountId: cash,
          debit: 0,
          credit: 120_000,
          description: null,
          vehicleId: null,
          customerId: null,
          vendorId: null,
        },
      ],
    });
    const year = await prisma.fiscalYear.findFirstOrThrow({
      where: {
        dealerId: closer.dealerId,
        startDate: new Date(`${lastYearDate.slice(0, 4)}-01-01T00:00:00Z`),
      },
    });
    const closed = await s.periods.closeYear(closer.ctx, year.id, 'Year end');
    expect(closed.netIncomeCents).toBe(380_000);

    const retained = await accountId(prisma, closer.dealerId, 'RETAINED_EARNINGS');
    const totals = await accountTotals(prisma, closer.dealerId);
    expect(debitBalance(totals.get(retained))).toBe(-380_000);
    expect(debitBalance(totals.get(revenue))).toBe(0);
    expect(debitBalance(totals.get(rent))).toBe(0);
    await expect(
      s.journal.create(closer.ctx, {
        date: lastYearDate,
        description: 'Late',
        memo: null,
        kind: 'STANDARD',
        post: true,
        lines: [
          {
            accountId: rent,
            debit: 100,
            credit: 0,
            description: null,
            vehicleId: null,
            customerId: null,
            vendorId: null,
          },
          {
            accountId: cash,
            debit: 0,
            credit: 100,
            description: null,
            vehicleId: null,
            customerId: null,
            vendorId: null,
          },
        ],
      }),
    ).rejects.toThrow(/closed/);

    await s.periods.reopenYear(closer.ctx, year.id, 'Auditor adjustment');
    const reopened = await accountTotals(prisma, closer.dealerId);
    expect(debitBalance(reopened.get(retained))).toBe(0);
    expect(debitBalance(reopened.get(revenue))).toBe(-500_000);
    await assertTrialBalance(closer.dealerId);
  });
});
