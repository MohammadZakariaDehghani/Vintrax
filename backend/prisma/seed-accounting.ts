/**
 * Demo books for North Shore Motors (BC, fiscal year from April 1) — for
 * local development and demo servers only, never production data.
 *
 * Every figure is posted through the real accounting services, so the demo
 * ledger obeys the same rules as live use: balanced entries, tax from the
 * configured rules, cost of sales from the vehicle's book value. Posted
 * entries cannot be deleted, so this runs once per database: if the dealer
 * already has accounting set up it does nothing.
 */
import type { PrismaClient } from '@prisma/client';
import {
  acquisitionSchema,
  bankTransactionSchema,
  billSchema,
  customerSchema,
  depositSchema,
  expenseSchema,
  floorPlanNoteSchema,
  paymentSchema,
  saleSchema,
  tradeInSchema,
  vendorSchema,
} from '@vintrax/shared';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { contextFor } from '../src/modules/accounting/core/context';
import { accountingServices } from '../src/modules/accounting/testing/services';
import { addDays, todayIso } from '../src/modules/accounting/core/dates';

export const ACCOUNTING_DEMO_STAFF = [
  {
    email: 'accountant@northshoremotors.test',
    firstName: 'Priya',
    lastName: 'Sandhu',
    role: 'ACCOUNTANT' as const,
  },
  {
    email: 'rep@northshoremotors.test',
    firstName: 'Tom',
    lastName: 'Becker',
    role: 'SALES_USER' as const,
  },
];

export async function seedAccounting(client: PrismaClient, passwordHash: string): Promise<string> {
  const owner = await client.user.findUnique({
    where: { email: 'sales@northshoremotors.test' },
    include: { dealer: true },
  });
  if (!owner?.dealer) return 'skipped (no North Shore Motors dealer)';
  const dealer = owner.dealer;

  // Staff accounts are upserted every run; the books only once.
  for (const staff of ACCOUNTING_DEMO_STAFF) {
    const user = await client.user.upsert({
      where: { email: staff.email },
      update: {},
      create: {
        email: staff.email,
        passwordHash,
        firstName: staff.firstName,
        lastName: staff.lastName,
        role: 'BUYER',
        status: 'ACTIVE',
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });
    await client.dealerMember.upsert({
      where: { dealerId_userId: { dealerId: dealer.id, userId: user.id } },
      update: { role: staff.role },
      create: { dealerId: dealer.id, userId: user.id, role: staff.role, addedById: owner.id },
    });
  }

  if (await client.accountingSettings.findUnique({ where: { dealerId: dealer.id } })) {
    return 'already set up (left as is)';
  }

  const prisma = new PrismaService();
  try {
    const s = accountingServices(prisma);
    const ctx = contextFor(dealer.id, owner.id, owner.id, owner.email, 'OWNER');
    const today = todayIso();
    const day = (offset: number) => addDays(today, -offset);
    const account = async (code: string) =>
      (
        await prisma.acctAccount.findFirstOrThrow({
          where: { dealerId: dealer.id, code },
          select: { id: true },
        })
      ).id;

    await s.settings.setup(ctx, {
      legalName: 'North Shore Motors Ltd.',
      businessNumber: '812345678',
      gstHstNumber: '812345678RT0001',
      pstNumber: 'PST-1234-5678',
      qstNumber: null,
      province: 'BC',
      fiscalYearStartMonth: 4,
      fiscalYearStartDay: 1,
      taxFilingFrequency: 'QUARTERLY',
      openingBank: {
        name: 'Operating chequing',
        bankName: 'Coast Credit Union',
        accountNumberLast4: '0142',
        openingBalance: 25_000_000,
      },
    });
    const chequing = (
      await prisma.bankAccount.findFirstOrThrow({
        where: { dealerId: dealer.id, type: 'CHEQUING' },
      })
    ).id;

    // Parties.
    const vendor = async (input: Record<string, unknown>) =>
      (await s.parties.createVendor(ctx, vendorSchema.parse(input))).id;
    const auction = await vendor({
      name: 'Pacific Auto Auction',
      kind: 'AUCTION',
      province: 'BC',
      paymentTermsDays: 7,
    });
    const recon = await vendor({
      name: 'Lonsdale Auto Body',
      kind: 'SUPPLIER',
      province: 'BC',
      paymentTermsDays: 30,
    });
    const lender = await vendor({
      name: 'Harbour Floor Plan Finance',
      kind: 'LENDER',
      province: 'BC',
    });
    const bank = await vendor({ name: 'Coast Auto Finance', kind: 'LENDER', province: 'BC' });
    const landlord = await vendor({
      name: 'Marine Drive Properties',
      kind: 'SUPPLIER',
      province: 'BC',
      paymentTermsDays: 0,
    });

    const customer = async (name: string, city: string) =>
      (await s.parties.createCustomer(ctx, customerSchema.parse({ name, city, province: 'BC' })))
        .id;
    const alex = await customer('Alex Chen', 'North Vancouver');
    const sam = await customer('Samira Haddad', 'West Vancouver');
    const lee = await customer('Lee Morgan', 'Burnaby');

    // Vehicles: the dealer's own active listings.
    const vehicles = await prisma.vehicle.findMany({
      where: { sellerId: owner.id, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, priceCad: true },
      take: 4,
    });
    if (vehicles.length < 3) return 'set up (too few listings for demo transactions)';
    const [first, second, third, fourth] = vehicles;

    // Purchases: auction (paid), auction (on account), trade-in style dealer buy on floor plan.
    const buy = (vehicleId: string, input: Record<string, unknown>) =>
      s.acquisitions.create(ctx, acquisitionSchema.parse({ vehicleId, ...input }));
    await buy(first!.id, {
      method: 'AUCTION',
      vendorId: auction,
      date: day(58),
      purchasePrice: String(Math.round(first!.priceCad * 0.78)),
      auctionFee: '650',
      transportation: '400',
      settlement: 'PAID',
      bankAccountId: chequing,
    });
    await buy(second!.id, {
      method: 'AUCTION',
      vendorId: auction,
      date: day(45),
      purchasePrice: String(Math.round(second!.priceCad * 0.8)),
      auctionFee: '700',
      settlement: 'ON_ACCOUNT',
    });
    await buy(third!.id, {
      method: 'DEALER',
      date: day(40),
      purchasePrice: String(Math.round(third!.priceCad * 0.82)),
      settlement: 'PAID',
      bankAccountId: chequing,
    });
    if (fourth) {
      await buy(fourth.id, {
        method: 'AUCTION',
        vendorId: auction,
        date: day(30),
        purchasePrice: String(Math.round(fourth.priceCad * 0.8)),
        auctionFee: '600',
        settlement: 'PAID',
        bankAccountId: chequing,
      });
      await s.floorPlan.createNote(
        ctx,
        floorPlanNoteSchema.parse({
          lenderVendorId: lender,
          vehicleId: fourth.id,
          principal: String(Math.round(fourth.priceCad * 0.7)),
          interestRate: '7.25',
          originationDate: day(29),
          bankAccountId: chequing,
          reference: 'FP-2026-118',
        }),
      );
    }

    // Reconditioning billed by the body shop, part-paid.
    const reconBill = await s.bills.create(
      ctx,
      billSchema.parse({
        vendorId: recon,
        vendorReference: 'LAB-5531',
        date: day(38),
        dueDate: day(8),
        lines: [
          {
            accountId: await account('1200'),
            description: 'Paint correction and detailing',
            amount: '1450',
            vehicleId: first!.id,
            costCategory: 'DETAILING',
          },
        ],
      }),
    );
    await s.payments.create(
      ctx,
      paymentSchema.parse({
        direction: 'SENT',
        vendorId: recon,
        date: day(20),
        amount: '800',
        method: 'BANK_TRANSFER',
        bankAccountId: chequing,
        reference: 'EFT-20931',
        allocations: [{ billId: reconBill.id, amount: '800' }],
      }),
    );

    // Operating expenses.
    const expense = (accountCode: string, input: Record<string, unknown>) =>
      account(accountCode).then((accountId) =>
        s.expenses.create(
          ctx,
          expenseSchema.parse({
            accountId,
            method: 'BANK_TRANSFER',
            bankAccountId: chequing,
            ...input,
          }),
        ),
      );
    await expense('6100', {
      date: day(33),
      vendorId: landlord,
      description: 'Lot and showroom rent',
      amount: '6500',
      reference: 'RENT-SEP',
    });
    await expense('6000', {
      date: day(25),
      description: 'Online listing promotion',
      amount: '850',
      applyTax: true,
    });
    await expense('6110', {
      date: day(18),
      description: 'Hydro and gas',
      amount: '612.40',
      applyTax: true,
    });
    await expense('6150', {
      date: day(12),
      description: 'Dealer management software',
      amount: '299',
      applyTax: true,
      method: 'CREDIT_CARD',
    });

    // A deposit, then a sale with a trade-in, part financed.
    const deposit = await s.deposits.receive(
      ctx,
      depositSchema.parse({
        customerId: alex,
        vehicleId: first!.id,
        date: day(15),
        amount: '1000',
        method: 'DEBIT',
        bankAccountId: chequing,
      }),
    );
    const trade = await s.tradeIns.create(
      ctx,
      tradeInSchema.parse({
        customerId: alex,
        year: 2016,
        make: 'Mazda',
        model: 'CX-5',
        mileageKm: 142_000,
        bodyType: 'SUV',
        drivetrain: 'AWD',
        appraisedValue: '9500',
        tradeAllowance: '10000',
      }),
    );
    const firstPrice = first!.priceCad;
    await s.sales.post(
      ctx,
      saleSchema.parse({
        vehicleId: first!.id,
        customerId: alex,
        saleDate: day(10),
        salePrice: String(firstPrice),
        documentationFee: '499',
        tradeInId: trade.id,
        deposits: [{ depositId: deposit.id, amount: '1000' }],
        downPayment: '5000',
        downPaymentMethod: 'DEBIT',
        bankAccountId: chequing,
        financedAmount: String(Math.max(0, Math.round(firstPrice * 0.5))),
        financeLenderVendorId: bank,
        financeRevenue: '450',
      }),
    );

    // A cash sale with a balance still owing (receivable).
    await s.sales.post(
      ctx,
      saleSchema.parse({
        vehicleId: third!.id,
        customerId: sam,
        saleDate: day(5),
        salePrice: String(third!.priceCad),
        documentationFee: '499',
        downPayment: String(Math.round(third!.priceCad * 0.9)),
        downPaymentMethod: 'BANK_TRANSFER',
        bankAccountId: chequing,
      }),
    );

    // A deposit held on a vehicle still in stock, and a bank fee.
    await s.deposits.receive(
      ctx,
      depositSchema.parse({
        customerId: lee,
        vehicleId: second!.id,
        date: day(3),
        amount: '500',
        method: 'CREDIT_CARD',
        bankAccountId: chequing,
      }),
    );
    await s.banking.createTransaction(
      ctx,
      bankTransactionSchema.parse({
        bankAccountId: chequing,
        kind: 'FEE',
        date: day(2),
        amount: '24.95',
        description: 'Monthly account fee',
      }),
    );

    return 'set up with demo transactions';
  } finally {
    await prisma.$disconnect();
  }
}
