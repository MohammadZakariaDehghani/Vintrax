import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Province, TaxRule } from '@prisma/client';
import {
  returnKindFor,
  TAX_RETURN_KINDS,
  type TaxFilingCreateInput,
  type TaxFilingUpdateInput,
  type TaxQuoteInput,
  type TaxReturnKind,
  type TaxRuleCreateInput,
  type TaxRuleSupersedeInput,
  type TaxType,
} from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { addDays, addMonths, fromDbDate, toDbDate, type IsoDate } from '../core/dates';
import { fromCents, sumCents, toCents } from '../core/money';
import type { SystemKey } from '../accounts/chart-of-accounts';
import {
  calculateTax,
  effectiveRules,
  type TaxCalculation,
  type TaxableLine,
  type TaxRuleInput,
} from './tax-engine';

type Tx = Prisma.TransactionClient;

export interface TaxRuleView {
  id: string;
  scope: 'PLATFORM' | 'DEALER';
  province: Province;
  taxType: TaxType;
  name: string;
  rate: string;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
  taxIncluded: boolean;
  taxableCategories: string[];
  exemptCategories: string[];
  minPriceCents: number | null;
  maxPriceCents: number | null;
  tradeInReducesBase: boolean;
  recoverable: boolean;
  source: string | null;
  notes: string | null;
  isActive: boolean;
  version: number;
  previousVersionId: string | null;
  usedCount: number;
}

/** Where a tax component posts: collected tax is a liability, recoverable paid tax an asset. */
export function payableAccountKey(taxType: TaxType): SystemKey {
  if (taxType === 'QST') return 'QST_PAYABLE';
  if (taxType === 'PST') return 'PST_PAYABLE';
  return 'GST_HST_PAYABLE';
}

export function recoverableAccountKey(taxType: TaxType): SystemKey {
  if (taxType === 'QST') return 'QST_RECOVERABLE';
  if (taxType === 'PST') return 'PST_RECOVERABLE';
  return 'GST_HST_RECOVERABLE';
}

@Injectable()
export class TaxService {
  constructor(private readonly prisma: PrismaService) {}

  /** The rules in force for a dealer, province and date. */
  async rulesFor(
    tx: Tx | PrismaService,
    dealerId: string,
    province: Province,
    date: IsoDate,
  ): Promise<Array<TaxRuleInput & { dealerId: string | null; province: Province }>> {
    const day = toDbDate(date);
    const rows = await tx.taxRule.findMany({
      where: {
        province,
        isActive: true,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
        AND: [{ OR: [{ dealerId: null }, { dealerId }] }],
      },
      orderBy: [{ taxType: 'asc' }, { minPriceCents: 'asc' }],
    });
    return effectiveRules(rows.map(toRuleInput));
  }

  async calculate(
    tx: Tx | PrismaService,
    dealerId: string,
    input: { province: Province; date: IsoDate; lines: TaxableLine[]; tradeInCents?: number; vehiclePriceCents?: number },
  ): Promise<TaxCalculation & { province: Province; date: IsoDate }> {
    const rules = await this.rulesFor(tx, dealerId, input.province, input.date);
    const calculation = calculateTax({
      rules,
      lines: input.lines,
      tradeInCents: input.tradeInCents,
      vehiclePriceCents: input.vehiclePriceCents,
    });
    return { ...calculation, province: input.province, date: input.date };
  }

  async quote(ctx: AccountingContext, input: TaxQuoteInput) {
    const calculation = await this.calculate(this.prisma, ctx.dealerId, {
      province: input.province,
      date: input.date,
      lines: input.lines.map((line) => ({ category: line.category, amountCents: line.amount })),
      tradeInCents: input.tradeIn,
      vehiclePriceCents: input.vehiclePrice > 0 ? input.vehiclePrice : undefined,
    });
    return {
      province: calculation.province,
      date: calculation.date,
      grossCents: calculation.grossCents,
      totalTaxCents: calculation.totalTaxCents,
      components: calculation.components,
    };
  }

  /**
   * Freezes the tax applied to one transaction. The rate is copied from the
   * rule, so a later rate change cannot touch what was posted.
   */
  async recordTaxLines(
    tx: Tx,
    ctx: AccountingContext,
    input: {
      calculation: TaxCalculation;
      province: Province;
      date: IsoDate;
      direction: 'COLLECTED' | 'PAID';
      sourceType: string;
      sourceId: string;
      journalEntryId: string | null;
    },
  ): Promise<void> {
    if (input.calculation.components.length === 0) return;
    // Exempt sales are counted once per return: when two rules of one return
    // apply (BC PST on the vehicle and on accessories), the exempt amount is
    // what neither taxed, carried on the return's first line only.
    const exemptByKind = new Map<TaxReturnKind, number>();
    for (const kind of TAX_RETURN_KINDS) {
      const group = input.calculation.components.filter((c) => returnKindFor(c.taxType) === kind);
      if (group.length === 0) continue;
      const taxed = sumCents(group.map((c) => c.taxableCents + c.tradeInDeductedCents));
      const exempt = input.calculation.grossCents - taxed;
      // A credit note carries negative amounts; its exempt part is negative too.
      exemptByKind.set(kind, input.calculation.grossCents >= 0 ? Math.max(0, exempt) : Math.min(0, exempt));
    }
    const seen = new Set<TaxReturnKind>();
    await tx.taxLine.createMany({
      data: input.calculation.components.map((component) => {
        const kind = returnKindFor(component.taxType);
        const exempt = seen.has(kind) ? 0 : (exemptByKind.get(kind) ?? 0);
        seen.add(kind);
        return {
          dealerId: ctx.dealerId,
        journalEntryId: input.journalEntryId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        taxRuleId: component.ruleId,
        taxType: component.taxType,
        province: input.province,
        rate: component.rate,
        taxableAmount: fromCents(component.taxableCents),
        exemptAmount: fromCents(exempt),
        amount: fromCents(component.taxCents),
        direction: input.direction,
        recoverable: input.direction === 'PAID' && component.recoverable,
        transactionDate: toDbDate(input.date),
        };
      }),
    });
  }

  /** Mirrors a source's tax lines with negative amounts when it is reversed. */
  async reverseTaxLines(
    tx: Tx,
    ctx: AccountingContext,
    input: { sourceType: string; sourceId: string; date: IsoDate; journalEntryId: string },
  ): Promise<void> {
    const lines = await tx.taxLine.findMany({
      where: { dealerId: ctx.dealerId, sourceType: input.sourceType, sourceId: input.sourceId, isReversal: false },
    });
    if (lines.length === 0) return;
    await tx.taxLine.createMany({
      data: lines.map((line) => ({
        dealerId: ctx.dealerId,
        journalEntryId: input.journalEntryId,
        sourceType: line.sourceType,
        sourceId: line.sourceId,
        taxRuleId: line.taxRuleId,
        taxType: line.taxType,
        province: line.province,
        rate: line.rate,
        taxableAmount: fromCents(-toCents(line.taxableAmount)),
        exemptAmount: fromCents(-toCents(line.exemptAmount)),
        amount: fromCents(-toCents(line.amount)),
        direction: line.direction,
        recoverable: line.recoverable,
        transactionDate: toDbDate(input.date),
        isReversal: true,
      })),
    });
  }

  // --- Rule management ------------------------------------------------------

  async listRules(ctx: AccountingContext, province?: Province): Promise<TaxRuleView[]> {
    const rows = await this.prisma.taxRule.findMany({
      where: {
        OR: [{ dealerId: null }, { dealerId: ctx.dealerId }],
        ...(province ? { province } : {}),
      },
      orderBy: [{ province: 'asc' }, { taxType: 'asc' }, { effectiveFrom: 'desc' }, { minPriceCents: 'asc' }],
      include: { _count: { select: { taxLines: { where: { dealerId: ctx.dealerId } } } } },
    });
    return rows.map((row) => toView(row, row._count.taxLines));
  }

  /** A dealer's own rule, which replaces the platform default for its tax type from its date. */
  async createDealerRule(ctx: AccountingContext, input: TaxRuleCreateInput): Promise<TaxRuleView> {
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.taxRule.create({
        data: {
          dealerId: ctx.dealerId,
          ...ruleData(input),
          createdById: ctx.userId,
        },
      });
      await recordAudit(tx, ctx, {
        action: 'tax.rule_created',
        entityType: 'TaxRule',
        entityId: rule.id,
        after: { province: rule.province, taxType: rule.taxType, rate: rule.rate.toString(), effectiveFrom: input.effectiveFrom },
      });
      return toView(rule, 0);
    });
  }

  /**
   * A rate change: the rule ends the day before `effectiveFrom`, and a new
   * version starts then. Transactions already posted keep the old rate.
   * A dealer superseding a platform rule creates their own override.
   */
  async supersedeRule(
    ctx: AccountingContext,
    ruleId: string,
    input: TaxRuleSupersedeInput,
  ): Promise<TaxRuleView> {
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.taxRule.findFirst({
        where: { id: ruleId, OR: [{ dealerId: null }, { dealerId: ctx.dealerId }] },
      });
      if (!rule) throw new NotFoundException('Tax rule not found');
      if (input.effectiveFrom <= fromDbDate(rule.effectiveFrom)) {
        throw new BadRequestException('The new rate must start after the current one did');
      }
      if (rule.effectiveTo && input.effectiveFrom > addDays(fromDbDate(rule.effectiveTo), 1)) {
        throw new BadRequestException('That rule already ended; create a new rule instead');
      }

      if (rule.dealerId) {
        await tx.taxRule.update({
          where: { id: rule.id },
          data: { effectiveTo: toDbDate(addDays(input.effectiveFrom, -1)) },
        });
      }
      const next = await tx.taxRule.create({
        data: {
          dealerId: ctx.dealerId,
          province: rule.province,
          taxType: rule.taxType,
          name: rule.name,
          rate: input.rate,
          effectiveFrom: toDbDate(input.effectiveFrom),
          effectiveTo: rule.dealerId ? rule.effectiveTo : null,
          taxIncluded: rule.taxIncluded,
          taxableCategories: rule.taxableCategories,
          exemptCategories: rule.exemptCategories,
          minPriceCents: rule.minPriceCents,
          maxPriceCents: rule.maxPriceCents,
          tradeInReducesBase: rule.tradeInReducesBase,
          recoverable: rule.recoverable,
          metadata: input.notes ? { notes: input.notes } : (rule.metadata ?? undefined),
          source: input.source,
          version: rule.version + 1,
          previousVersionId: rule.id,
          createdById: ctx.userId,
        },
      });
      await recordAudit(tx, ctx, {
        action: 'tax.rule_superseded',
        entityType: 'TaxRule',
        entityId: next.id,
        before: { ruleId: rule.id, rate: rule.rate.toString() },
        after: { rate: input.rate, effectiveFrom: input.effectiveFrom },
      });
      return toView(next, 0);
    });
  }

  async setRuleActive(ctx: AccountingContext, ruleId: string, isActive: boolean): Promise<TaxRuleView> {
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.taxRule.findFirst({ where: { id: ruleId } });
      if (!rule) throw new NotFoundException('Tax rule not found');
      if (rule.dealerId !== ctx.dealerId) {
        throw new ForbiddenException('Platform default rules are managed by Vintrax; add your own rule to override one');
      }
      const updated = await tx.taxRule.update({ where: { id: rule.id }, data: { isActive } });
      await recordAudit(tx, ctx, {
        action: isActive ? 'tax.rule_activated' : 'tax.rule_deactivated',
        entityType: 'TaxRule',
        entityId: rule.id,
        before: { isActive: rule.isActive },
        after: { isActive },
      });
      return toView(updated, 0);
    });
  }

  // --- Platform defaults (super admin) -------------------------------------

  async listPlatformRules(): Promise<TaxRuleView[]> {
    const rows = await this.prisma.taxRule.findMany({
      where: { dealerId: null },
      orderBy: [{ province: 'asc' }, { taxType: 'asc' }, { effectiveFrom: 'desc' }, { minPriceCents: 'asc' }],
      include: { _count: { select: { taxLines: true } } },
    });
    return rows.map((row) => toView(row, row._count.taxLines));
  }

  async createPlatformRule(actorId: string, input: TaxRuleCreateInput): Promise<TaxRuleView> {
    const rule = await this.prisma.taxRule.create({
      data: { dealerId: null, ...ruleData(input), createdById: actorId },
    });
    return toView(rule, 0);
  }

  async supersedePlatformRule(actorId: string, ruleId: string, input: TaxRuleSupersedeInput): Promise<TaxRuleView> {
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.taxRule.findFirst({ where: { id: ruleId, dealerId: null } });
      if (!rule) throw new NotFoundException('Tax rule not found');
      if (input.effectiveFrom <= fromDbDate(rule.effectiveFrom)) {
        throw new BadRequestException('The new rate must start after the current one did');
      }
      await tx.taxRule.update({
        where: { id: rule.id },
        data: { effectiveTo: toDbDate(addDays(input.effectiveFrom, -1)) },
      });
      const next = await tx.taxRule.create({
        data: {
          dealerId: null,
          province: rule.province,
          taxType: rule.taxType,
          name: rule.name,
          rate: input.rate,
          effectiveFrom: toDbDate(input.effectiveFrom),
          effectiveTo: rule.effectiveTo,
          taxIncluded: rule.taxIncluded,
          taxableCategories: rule.taxableCategories,
          exemptCategories: rule.exemptCategories,
          minPriceCents: rule.minPriceCents,
          maxPriceCents: rule.maxPriceCents,
          tradeInReducesBase: rule.tradeInReducesBase,
          recoverable: rule.recoverable,
          metadata: input.notes ? { notes: input.notes } : (rule.metadata ?? undefined),
          source: input.source,
          version: rule.version + 1,
          previousVersionId: rule.id,
          createdById: actorId,
        },
      });
      return toView(next, 0);
    });
  }

  // --- Filing periods and the Tax Center -----------------------------------

  async listFilings(ctx: AccountingContext) {
    const filings = await this.prisma.taxFilingPeriod.findMany({
      where: { dealerId: ctx.dealerId },
      orderBy: [{ startDate: 'desc' }, { kind: 'asc' }],
    });
    return Promise.all(
      filings.map(async (filing) => ({
        id: filing.id,
        kind: filing.kind as TaxReturnKind,
        frequency: filing.frequency,
        startDate: fromDbDate(filing.startDate),
        endDate: fromDbDate(filing.endDate),
        status: filing.status,
        adjustmentsCents: toCents(filing.adjustments),
        filedAt: filing.filedAt?.toISOString() ?? null,
        confirmationNumber: filing.confirmationNumber,
        notes: filing.notes,
        summary: (
          await this.summary(ctx, fromDbDate(filing.startDate), fromDbDate(filing.endDate))
        ).find((row) => row.kind === filing.kind)!,
      })),
    );
  }

  async createFiling(ctx: AccountingContext, input: TaxFilingCreateInput) {
    return this.prisma.$transaction(async (tx) => {
      const overlap = await tx.taxFilingPeriod.findFirst({
        where: {
          dealerId: ctx.dealerId,
          kind: input.kind,
          startDate: { lte: toDbDate(input.endDate) },
          endDate: { gte: toDbDate(input.startDate) },
        },
      });
      if (overlap) throw new ConflictException('That period overlaps an existing filing period');
      const filing = await tx.taxFilingPeriod.create({
        data: {
          dealerId: ctx.dealerId,
          kind: input.kind,
          frequency: input.frequency,
          startDate: toDbDate(input.startDate),
          endDate: toDbDate(input.endDate),
        },
      });
      await recordAudit(tx, ctx, {
        action: 'tax.filing_created',
        entityType: 'TaxFilingPeriod',
        entityId: filing.id,
        after: input,
      });
      return { id: filing.id };
    });
  }

  /** Creates the filing periods of a fiscal year at the dealer's filing frequency. */
  async generateFilings(ctx: AccountingContext, fiscalYearStart: IsoDate) {
    const settings = await this.prisma.accountingSettings.findUniqueOrThrow({
      where: { dealerId: ctx.dealerId },
    });
    const months = settings.taxFilingFrequency === 'MONTHLY' ? 1 : settings.taxFilingFrequency === 'QUARTERLY' ? 3 : 12;
    const kinds = applicableReturnKinds(settings.province);
    let created = 0;
    await this.prisma.$transaction(async (tx) => {
      for (let start = fiscalYearStart; start < addMonths(fiscalYearStart, 12); start = addMonths(start, months)) {
        const end = addDays(addMonths(start, months), -1);
        for (const kind of kinds) {
          const exists = await tx.taxFilingPeriod.findFirst({
            where: {
              dealerId: ctx.dealerId,
              kind,
              startDate: { lte: toDbDate(end) },
              endDate: { gte: toDbDate(start) },
            },
          });
          if (exists) continue;
          await tx.taxFilingPeriod.create({
            data: {
              dealerId: ctx.dealerId,
              kind,
              frequency: settings.taxFilingFrequency,
              startDate: toDbDate(start),
              endDate: toDbDate(end),
            },
          });
          created += 1;
        }
      }
      await recordAudit(tx, ctx, {
        action: 'tax.filings_generated',
        entityType: 'TaxFilingPeriod',
        after: { fiscalYearStart, created },
      });
    });
    return { created };
  }

  async updateFiling(ctx: AccountingContext, filingId: string, input: TaxFilingUpdateInput) {
    return this.prisma.$transaction(async (tx) => {
      const filing = await tx.taxFilingPeriod.findFirst({ where: { id: filingId, dealerId: ctx.dealerId } });
      if (!filing) throw new NotFoundException('Filing period not found');
      if (filing.status === 'CLOSED' && input.status !== 'CLOSED') {
        throw new ConflictException('A closed filing period cannot be changed');
      }
      const updated = await tx.taxFilingPeriod.update({
        where: { id: filing.id },
        data: {
          ...(input.status ? { status: input.status } : {}),
          ...(input.adjustments !== undefined ? { adjustments: fromCents(input.adjustments) } : {}),
          ...(input.confirmationNumber !== undefined ? { confirmationNumber: input.confirmationNumber } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.status === 'FILED' && filing.status !== 'FILED'
            ? { filedAt: new Date(), filedById: ctx.userId }
            : {}),
        },
      });
      await recordAudit(tx, ctx, {
        action: 'tax.filing_updated',
        entityType: 'TaxFilingPeriod',
        entityId: filing.id,
        before: { status: filing.status, adjustments: filing.adjustments.toString() },
        after: { status: updated.status, adjustments: updated.adjustments.toString() },
      });
      return { id: updated.id, status: updated.status };
    });
  }

  /**
   * The Tax Center figures for a date range, from the frozen tax lines:
   * collected, paid, recoverable, net, taxable and exempt sales.
   */
  async summary(ctx: AccountingContext, from: IsoDate, to: IsoDate) {
    const lines = await this.prisma.taxLine.findMany({
      where: { dealerId: ctx.dealerId, transactionDate: { gte: toDbDate(from), lte: toDbDate(to) } },
      select: {
        taxType: true,
        direction: true,
        recoverable: true,
        amount: true,
        taxableAmount: true,
        exemptAmount: true,
        sourceType: true,
        sourceId: true,
      },
    });
    const filings = await this.prisma.taxFilingPeriod.findMany({
      where: { dealerId: ctx.dealerId, startDate: { gte: toDbDate(from) }, endDate: { lte: toDbDate(to) } },
      select: { kind: true, adjustments: true },
    });

    return TAX_RETURN_KINDS.map((kind) => {
      const mine = lines.filter((line) => returnKindFor(line.taxType) === kind);
      const collected = mine.filter((line) => line.direction === 'COLLECTED');
      const paid = mine.filter((line) => line.direction === 'PAID');
      const collectedCents = sumCents(collected.map((line) => toCents(line.amount)));
      const paidCents = sumCents(paid.map((line) => toCents(line.amount)));
      const recoverableCents = sumCents(paid.filter((line) => line.recoverable).map((line) => toCents(line.amount)));
      const adjustmentsCents = sumCents(
        filings.filter((filing) => filing.kind === kind).map((filing) => toCents(filing.adjustments)),
      );
      return {
        kind,
        collectedCents,
        paidCents,
        recoverableCents,
        netCents: collectedCents - recoverableCents + adjustmentsCents,
        taxableSalesCents: sumCents(collected.map((line) => toCents(line.taxableAmount))),
        exemptSalesCents: sumCents(collected.map((line) => toCents(line.exemptAmount))),
        adjustmentsCents,
        transactions: new Set(mine.map((line) => `${line.sourceType}:${line.sourceId}`)).size,
      };
    });
  }
}

/** Which returns a dealer in this province files. */
export function applicableReturnKinds(province: Province): TaxReturnKind[] {
  if (province === 'QC') return ['GST_HST', 'QST'];
  if (province === 'BC' || province === 'SK' || province === 'MB') return ['GST_HST', 'PST'];
  return ['GST_HST'];
}

function toRuleInput(row: TaxRule): TaxRuleInput & { dealerId: string | null; province: Province } {
  return {
    id: row.id,
    dealerId: row.dealerId,
    province: row.province,
    taxType: row.taxType,
    rate: row.rate.toString(),
    taxableCategories: row.taxableCategories,
    exemptCategories: row.exemptCategories,
    minPriceCents: row.minPriceCents === null ? null : Number(row.minPriceCents),
    maxPriceCents: row.maxPriceCents === null ? null : Number(row.maxPriceCents),
    tradeInReducesBase: row.tradeInReducesBase,
    recoverable: row.recoverable,
    taxIncluded: row.taxIncluded,
  };
}

function toView(row: TaxRule, usedCount: number): TaxRuleView {
  const metadata = (row.metadata ?? {}) as { notes?: string };
  return {
    id: row.id,
    scope: row.dealerId ? 'DEALER' : 'PLATFORM',
    province: row.province,
    taxType: row.taxType,
    name: row.name,
    rate: row.rate.toString(),
    effectiveFrom: fromDbDate(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? fromDbDate(row.effectiveTo) : null,
    taxIncluded: row.taxIncluded,
    taxableCategories: row.taxableCategories,
    exemptCategories: row.exemptCategories,
    minPriceCents: row.minPriceCents === null ? null : Number(row.minPriceCents),
    maxPriceCents: row.maxPriceCents === null ? null : Number(row.maxPriceCents),
    tradeInReducesBase: row.tradeInReducesBase,
    recoverable: row.recoverable,
    source: row.source,
    notes: metadata.notes ?? null,
    isActive: row.isActive,
    version: row.version,
    previousVersionId: row.previousVersionId,
    usedCount,
  };
}

function ruleData(input: TaxRuleCreateInput) {
  return {
    province: input.province,
    taxType: input.taxType,
    name: input.name,
    rate: input.rate,
    effectiveFrom: toDbDate(input.effectiveFrom),
    effectiveTo: input.effectiveTo ? toDbDate(input.effectiveTo) : null,
    taxIncluded: input.taxIncluded,
    taxableCategories: input.taxableCategories,
    exemptCategories: input.exemptCategories,
    minPriceCents: input.minPriceCents ?? null,
    maxPriceCents: input.maxPriceCents ?? null,
    tradeInReducesBase: input.tradeInReducesBase,
    recoverable: input.recoverable,
    metadata: input.notes ? { notes: input.notes } : undefined,
    source: input.source,
  };
}
