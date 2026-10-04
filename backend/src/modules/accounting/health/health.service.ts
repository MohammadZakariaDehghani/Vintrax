import { centsToDecimalString } from '@vintrax/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { addDays, fromDbDate, todayIso, toDbDate } from '../core/dates';
import { sumCents, toCents } from '../core/money';
import { SYSTEM_KEYS } from '../accounts/chart-of-accounts';
import { accountTotals, debitBalance } from '../reports/ledger';
import { OperationsReportsService } from '../reports/operations.service';

export interface HealthFinding {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  title: string;
  detail: string;
  count: number;
  links: Array<{ label: string; href: string }>;
}

const MAX_LINKS = 10;

/**
 * Checks the books for problems a dealer or accountant should look at. Each
 * finding says what is wrong, how many records it affects, and links to them.
 * The database already prevents the worst (unbalanced or edited postings);
 * these checks are there to prove it, and to catch what it cannot see.
 */
@Injectable()
export class AccountingHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operations: OperationsReportsService,
  ) {}

  async check(ctx: AccountingContext) {
    const findings: HealthFinding[] = [];
    const add = (finding: HealthFinding) => {
      if (finding.count > 0)
        findings.push({ ...finding, links: finding.links.slice(0, MAX_LINKS) });
    };
    const settings = await this.prisma.accountingSettings.findUniqueOrThrow({
      where: { dealerId: ctx.dealerId },
    });

    // 1. Unbalanced posted entries (the database refuses these; this proves it).
    const unbalanced = await this.prisma.$queryRaw<Array<{ id: string; reference: string }>>`
      SELECT e."id", e."reference" FROM "JournalEntry" e
        JOIN "JournalLine" l ON l."entryId" = e."id"
       WHERE e."dealerId" = ${ctx.dealerId}::uuid AND e."status" = 'POSTED'
       GROUP BY e."id", e."reference"
      HAVING SUM(l."debit") <> SUM(l."credit")`;
    add({
      code: 'UNBALANCED_JOURNAL',
      severity: 'ERROR',
      title: 'Unbalanced journal entries',
      detail: 'Posted entries whose debits do not equal their credits.',
      count: unbalanced.length,
      links: unbalanced.map((row) => ({
        label: row.reference,
        href: `/dealer/accounting/journal/${row.id}`,
      })),
    });

    // 2. Missing or inactive system accounts.
    const system = await this.prisma.acctAccount.findMany({
      where: { dealerId: ctx.dealerId, systemKey: { not: null } },
      select: { systemKey: true, isActive: true, name: true },
    });
    const missing = SYSTEM_KEYS.filter(
      (key) => !system.some((account) => account.systemKey === key && account.isActive),
    );
    add({
      code: 'MISSING_ACCOUNTS',
      severity: 'ERROR',
      title: 'Missing accounts',
      detail: `Automatic postings need these accounts: ${missing.join(', ').toLowerCase().replace(/_/g, ' ')}.`,
      count: missing.length,
      links: [{ label: 'Chart of accounts', href: '/dealer/accounting/accounts' }],
    });

    // 3. Tax lines that disagree with the tax posted in their journal entry.
    const taxMismatch = await this.prisma.$queryRaw<Array<{ id: string; reference: string }>>`
      WITH frozen AS (
        SELECT t."journalEntryId" AS id,
               SUM(CASE WHEN t."direction" = 'COLLECTED' THEN t."amount" ELSE 0 END) AS collected
          FROM "TaxLine" t
         WHERE t."dealerId" = ${ctx.dealerId}::uuid AND t."journalEntryId" IS NOT NULL
         GROUP BY t."journalEntryId"
      ), posted AS (
        SELECT l."entryId" AS id, SUM(l."credit" - l."debit") AS collected
          FROM "JournalLine" l JOIN "AcctAccount" a ON a."id" = l."accountId"
         WHERE l."dealerId" = ${ctx.dealerId}::uuid AND a."subtype" = 'TAX_PAYABLE'
         GROUP BY l."entryId"
      )
      SELECT e."id", e."reference" FROM frozen f
        JOIN "JournalEntry" e ON e."id" = f.id
        LEFT JOIN posted p ON p.id = f.id
       WHERE e."source" <> 'REVERSAL' AND COALESCE(p.collected, 0) <> f.collected`;
    add({
      code: 'TAX_INCONSISTENCY',
      severity: 'ERROR',
      title: 'Tax inconsistencies',
      detail:
        'Entries where the tax recorded for the tax return differs from the tax posted to the ledger.',
      count: taxMismatch.length,
      links: taxMismatch.map((row) => ({
        label: row.reference,
        href: `/dealer/accounting/journal/${row.id}`,
      })),
    });

    // 4. Inventory: vehicle-tagged book values against the inventory account,
    //    negative book values, and cars sold with cost still on the books.
    const valuation = await this.operations.inventoryValuation(ctx);
    add({
      code: 'INVENTORY_MISMATCH',
      severity: 'WARNING',
      title: 'Inventory does not match the ledger',
      detail: `The vehicles’ book values add up to ${centsToDecimalString(valuation.totalCents)} but Vehicle Inventory holds ${centsToDecimalString(valuation.ledgerBalanceCents)}: an entry to inventory has no vehicle.`,
      count: valuation.differenceCents !== 0 ? 1 : 0,
      links: [
        {
          label: 'General ledger — Vehicle Inventory',
          href: '/dealer/accounting/ledger?account=VEHICLE_INVENTORY',
        },
      ],
    });
    const negative = valuation.rows.filter(
      (row) => row.bookValueCents < 0 && !settings.allowNegativeInventory,
    );
    add({
      code: 'NEGATIVE_INVENTORY',
      severity: 'ERROR',
      title: 'Negative inventory',
      detail: 'Vehicles with a negative book value.',
      count: negative.length,
      links: negative.map((row) => ({
        label: `${row.year} ${row.make} ${row.model}`,
        href: `/dealer/accounting/vehicles/${row.vehicleId}`,
      })),
    });

    // A posted sale whose listing is back on the lot: the vehicle could be
    // sold twice, and inventory reports would disagree with the listing.
    const relisted = await this.prisma.vehicleSale.findMany({
      where: { dealerId: ctx.dealerId, status: 'POSTED', vehicle: { status: { not: 'SOLD' } } },
      select: { id: true, number: true, vehicle: { select: { year: true, make: true, model: true } } },
      take: 50,
    });
    add({
      code: 'SOLD_VEHICLE_LISTED',
      severity: 'WARNING',
      title: 'Sold vehicles still listed',
      detail:
        'These vehicles have a posted sale but their listing is not marked sold. Mark the listing sold, or reverse the sale if it fell through.',
      count: relisted.length,
      links: relisted.map((row) => ({
        label: `Deal #${row.number} · ${row.vehicle.year} ${row.vehicle.make} ${row.vehicle.model}`,
        href: `/dealer/accounting/sales/${row.id}`,
      })),
    });

    // 5. Missing accounting: vehicles marked sold, since accounting began,
    //    without a posted sale; costs entered only on the Costs page.
    const since = settings.createdAt;
    const soldOutside = await this.prisma.vehicle.findMany({
      where: {
        sellerId: ctx.ownerUserId,
        status: 'SOLD',
        soldAt: { gte: since },
        sales: { none: { status: 'POSTED' } },
      },
      select: { id: true, year: true, make: true, model: true },
      take: 50,
    });
    add({
      code: 'MISSING_SALE_ENTRIES',
      severity: 'WARNING',
      title: 'Sold vehicles without a sale in accounting',
      detail:
        'These vehicles were marked sold but no sale was posted, so their revenue, tax and cost of sales are not on the books.',
      count: soldOutside.length,
      links: soldOutside.map((row) => ({
        label: `${row.year} ${row.make} ${row.model}`,
        href: `/dealer/accounting/sales/new?vehicleId=${row.id}`,
      })),
    });
    const offBookCosts = await this.prisma.vehicleCost.findMany({
      where: {
        journalEntryId: null,
        createdAt: { gte: since },
        vehicle: { sellerId: ctx.ownerUserId },
      },
      select: { vehicleId: true },
    });
    add({
      code: 'COSTS_NOT_POSTED',
      severity: 'INFO',
      title: 'Vehicle costs not in the ledger',
      detail:
        'Costs entered on the Costs page are a management record only. Record them as expenses or purchases to include them in inventory and cost of sales.',
      count: offBookCosts.length,
      links: [...new Set(offBookCosts.map((row) => row.vehicleId))].map((id) => ({
        label: 'Vehicle costs',
        href: `/dealer/costs/${id}`,
      })),
    });

    // 6. Receivables and payables against their control accounts.
    const accounts = await this.prisma.acctAccount.findMany({
      where: { dealerId: ctx.dealerId, subtype: { in: ['RECEIVABLE', 'PAYABLE'] } },
      select: { id: true, subtype: true },
    });
    const totals = await accountTotals(this.prisma, ctx.dealerId, {
      accountIds: accounts.map((account) => account.id),
    });
    const ledgerAr = sumCents(
      accounts.filter((a) => a.subtype === 'RECEIVABLE').map((a) => debitBalance(totals.get(a.id))),
    );
    const ledgerAp = -sumCents(
      accounts.filter((a) => a.subtype === 'PAYABLE').map((a) => debitBalance(totals.get(a.id))),
    );
    const [invoices, bills, payments] = await Promise.all([
      this.prisma.customerInvoice.findMany({
        where: { dealerId: ctx.dealerId, status: { not: 'VOID' } },
        select: { total: true, amountPaid: true },
      }),
      this.prisma.vendorBill.findMany({
        where: { dealerId: ctx.dealerId, status: { not: 'VOID' } },
        select: { kind: true, total: true, amountPaid: true },
      }),
      this.prisma.payment.findMany({
        where: { dealerId: ctx.dealerId, status: 'POSTED' },
        select: {
          amount: true,
          kind: true,
          customerId: true,
          vendorId: true,
          allocations: { select: { amount: true } },
        },
      }),
    ]);
    const unappliedCustomer = sumCents(
      payments
        .filter((p) => p.customerId)
        .map(
          (p) =>
            (p.kind === 'REFUND' ? -1 : 1) *
            (toCents(p.amount) - sumCents(p.allocations.map((a) => toCents(a.amount)))),
        ),
    );
    const unappliedVendor = sumCents(
      payments
        .filter((p) => p.vendorId)
        .map(
          (p) =>
            (p.kind === 'REFUND' ? -1 : 1) *
            (toCents(p.amount) - sumCents(p.allocations.map((a) => toCents(a.amount)))),
        ),
    );
    const expectedAr =
      sumCents(invoices.map((i) => toCents(i.total) - toCents(i.amountPaid))) - unappliedCustomer;
    const expectedAp =
      sumCents(
        bills.filter((b) => b.kind === 'BILL').map((b) => toCents(b.total) - toCents(b.amountPaid)),
      ) -
      sumCents(
        bills
          .filter((b) => b.kind === 'CREDIT_NOTE')
          .map((b) => toCents(b.total) - toCents(b.amountPaid)),
      ) -
      unappliedVendor;
    add({
      code: 'AR_MISMATCH',
      severity: 'WARNING',
      title: 'Receivables do not match open invoices',
      detail: `Accounts Receivable is ${centsToDecimalString(ledgerAr)}; open invoices less unapplied payments come to ${centsToDecimalString(expectedAr)}. A manual entry to AR without an invoice is the usual cause.`,
      count: ledgerAr !== expectedAr ? 1 : 0,
      links: [{ label: 'Accounts receivable', href: '/dealer/accounting/receivables' }],
    });
    add({
      code: 'AP_MISMATCH',
      severity: 'WARNING',
      title: 'Payables do not match open bills',
      detail: `Accounts Payable is ${centsToDecimalString(ledgerAp)}; open bills less credits and unapplied payments come to ${centsToDecimalString(expectedAp)}.`,
      count: ledgerAp !== expectedAp ? 1 : 0,
      links: [{ label: 'Accounts payable', href: '/dealer/accounting/payables' }],
    });

    // 7. Bank reconciliation.
    const openRecs = await this.prisma.bankReconciliation.findMany({
      where: { dealerId: ctx.dealerId, status: 'IN_PROGRESS', difference: { not: 0 } },
      select: {
        id: true,
        statementDate: true,
        difference: true,
        bankAccount: { select: { name: true } },
      },
    });
    add({
      code: 'RECONCILIATION_DIFFERENCE',
      severity: 'WARNING',
      title: 'Bank reconciliation differences',
      detail: 'Reconciliations in progress whose statement and cleared items do not agree.',
      count: openRecs.length,
      links: openRecs.map((rec) => ({
        label: `${rec.bankAccount.name} — ${fromDbDate(rec.statementDate)} (${centsToDecimalString(toCents(rec.difference))})`,
        href: `/dealer/accounting/banking/reconciliation/${rec.id}`,
      })),
    });
    const stale = await this.prisma.journalLine.count({
      where: {
        dealerId: ctx.dealerId,
        reconciliationId: null,
        account: { subtype: 'BANK' },
        entry: { status: 'POSTED', date: { lt: toDbDate(addDays(todayIso(), -60)) } },
      },
    });
    add({
      code: 'UNRECONCILED_BANK',
      severity: 'INFO',
      title: 'Old unreconciled bank items',
      detail: 'Bank movements more than 60 days old that no reconciliation has cleared.',
      count: stale,
      links: [{ label: 'Banking', href: '/dealer/accounting/banking' }],
    });

    // 8. Postings into a period after it was closed (the database prevents it).
    const lateInClosed = await this.prisma.$queryRaw<Array<{ id: string; reference: string }>>`
      SELECT e."id", e."reference" FROM "JournalEntry" e
        JOIN "AccountingPeriod" p ON p."dealerId" = e."dealerId" AND e."date" BETWEEN p."startDate" AND p."endDate"
       WHERE e."dealerId" = ${ctx.dealerId}::uuid AND e."status" = 'POSTED' AND p."status" = 'CLOSED'
         AND p."closedAt" IS NOT NULL AND e."postedAt" > p."closedAt"`;
    add({
      code: 'CLOSED_PERIOD_POSTING',
      severity: 'ERROR',
      title: 'Postings in closed periods',
      detail: 'Entries posted into a period after it was closed.',
      count: lateInClosed.length,
      links: lateInClosed.map((row) => ({
        label: row.reference,
        href: `/dealer/accounting/journal/${row.id}`,
      })),
    });

    // 9. Duplicate references: the same vendor invoice entered twice.
    const duplicateBills = await this.prisma.$queryRaw<
      Array<{ vendorReference: string; n: number }>
    >`
      SELECT "vendorReference", COUNT(*)::int AS n FROM "VendorBill"
       WHERE "dealerId" = ${ctx.dealerId}::uuid AND "status" <> 'VOID' AND "vendorReference" IS NOT NULL
       GROUP BY "vendorId", "vendorReference" HAVING COUNT(*) > 1`;
    add({
      code: 'DUPLICATE_REFERENCE',
      severity: 'WARNING',
      title: 'Duplicate vendor invoice numbers',
      detail: 'The same vendor invoice number is entered more than once.',
      count: duplicateBills.length,
      links: duplicateBills.map((row) => ({
        label: row.vendorReference,
        href: `/dealer/accounting/payables?q=${encodeURIComponent(row.vendorReference)}`,
      })),
    });
    const duplicatePayments = await this.prisma.$queryRaw<Array<{ reference: string }>>`
      SELECT "reference" FROM "Payment"
       WHERE "dealerId" = ${ctx.dealerId}::uuid AND "status" = 'POSTED' AND "reference" IS NOT NULL
       GROUP BY "reference", "amount", "date" HAVING COUNT(*) > 1`;
    add({
      code: 'DUPLICATE_PAYMENT',
      severity: 'WARNING',
      title: 'Possible duplicate payments',
      detail: 'Payments with the same reference, amount and date.',
      count: duplicatePayments.length,
      links: duplicatePayments.map((row) => ({
        label: row.reference,
        href: `/dealer/accounting/payments?reference=${encodeURIComponent(row.reference)}`,
      })),
    });

    // 10. Orphans: entries pointing at a document that does not exist.
    const orphans = await this.prisma.$queryRaw<Array<{ id: string; reference: string }>>`
      SELECT e."id", e."reference" FROM "JournalEntry" e
       WHERE e."dealerId" = ${ctx.dealerId}::uuid AND e."sourceType" IS NOT NULL AND (
         (e."sourceType" = 'VehicleSale' AND NOT EXISTS (SELECT 1 FROM "VehicleSale" x WHERE x."id" = e."sourceId")) OR
         (e."sourceType" = 'VehicleAcquisition' AND NOT EXISTS (SELECT 1 FROM "VehicleAcquisition" x WHERE x."id" = e."sourceId")) OR
         (e."sourceType" = 'Expense' AND NOT EXISTS (SELECT 1 FROM "Expense" x WHERE x."id" = e."sourceId")) OR
         (e."sourceType" = 'Payment' AND NOT EXISTS (SELECT 1 FROM "Payment" x WHERE x."id" = e."sourceId")) OR
         (e."sourceType" = 'VendorBill' AND NOT EXISTS (SELECT 1 FROM "VendorBill" x WHERE x."id" = e."sourceId")) OR
         (e."sourceType" = 'CustomerInvoice' AND NOT EXISTS (SELECT 1 FROM "CustomerInvoice" x WHERE x."id" = e."sourceId")) OR
         (e."sourceType" = 'CustomerDeposit' AND NOT EXISTS (SELECT 1 FROM "CustomerDeposit" x WHERE x."id" = e."sourceId"))
       )`;
    add({
      code: 'ORPHANED_TRANSACTION',
      severity: 'ERROR',
      title: 'Orphaned transactions',
      detail: 'Journal entries whose source document no longer exists.',
      count: orphans.length,
      links: orphans.map((row) => ({
        label: row.reference,
        href: `/dealer/accounting/journal/${row.id}`,
      })),
    });

    // 11. Floor plans on sold vehicles; old drafts.
    const outOfTrust = await this.prisma.floorPlanNote.findMany({
      where: { dealerId: ctx.dealerId, status: 'ACTIVE', vehicle: { status: 'SOLD' } },
      select: { id: true, vehicle: { select: { year: true, make: true, model: true } } },
    });
    add({
      code: 'FLOOR_PLAN_SOLD',
      severity: 'WARNING',
      title: 'Floor plans on sold vehicles',
      detail: 'These vehicles have sold but their floor plan is still outstanding.',
      count: outOfTrust.length,
      links: outOfTrust.map((note) => ({
        label: `${note.vehicle.year} ${note.vehicle.make} ${note.vehicle.model}`,
        href: `/dealer/accounting/floor-plan`,
      })),
    });
    const oldDrafts = await this.prisma.journalEntry.count({
      where: {
        dealerId: ctx.dealerId,
        status: 'DRAFT',
        createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) },
      },
    });
    add({
      code: 'OLD_DRAFTS',
      severity: 'INFO',
      title: 'Old draft entries',
      detail:
        'Draft journal entries more than 30 days old. They are not on the books until posted.',
      count: oldDrafts,
      links: [{ label: 'Journal entries', href: '/dealer/accounting/journal?status=DRAFT' }],
    });

    const order = { ERROR: 0, WARNING: 1, INFO: 2 } as const;
    findings.sort((a, b) => order[a.severity] - order[b.severity]);
    return {
      checkedAt: new Date().toISOString(),
      healthy: findings.every((finding) => finding.severity === 'INFO'),
      errors: findings.filter((finding) => finding.severity === 'ERROR').length,
      warnings: findings.filter((finding) => finding.severity === 'WARNING').length,
      findings,
    };
  }
}
