import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { JournalCreateInput, JournalReverseInput, ReportQuery } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { fromDbDate, toDbDate } from '../core/dates';
import { fromCents, toCents } from '../core/money';
import { resolveRange } from '../reports/date-ranges';
import { PostingService } from './posting.service';

@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  async list(ctx: AccountingContext, query: ReportQuery) {
    const range = await resolveRange(this.prisma, ctx.dealerId, query);
    const where: Prisma.JournalEntryWhereInput = {
      dealerId: ctx.dealerId,
      date: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
      ...(query.source ? { source: query.source } : {}),
      ...(query.status === 'DRAFT' || query.status === 'POSTED' ? { status: query.status } : {}),
      ...(query.userId ? { createdById: query.userId } : {}),
      ...(query.reference ? { reference: { contains: query.reference, mode: 'insensitive' } } : {}),
      ...(query.q
        ? {
            OR: [
              { description: { contains: query.q, mode: 'insensitive' } },
              { reference: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.accountId || query.vehicleId || query.customerId || query.vendorId
        ? {
            lines: {
              some: {
                ...(query.accountId ? { accountId: query.accountId } : {}),
                ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
                ...(query.customerId ? { customerId: query.customerId } : {}),
                ...(query.vendorId ? { vendorId: query.vendorId } : {}),
              },
            },
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.journalEntry.count({ where }),
      this.prisma.journalEntry.findMany({
        where,
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          number: true,
          reference: true,
          date: true,
          description: true,
          source: true,
          kind: true,
          status: true,
          total: true,
          sourceType: true,
          sourceId: true,
          reversedAt: true,
          reversalOfId: true,
          createdById: true,
        },
      }),
    ]);
    return {
      range,
      items: rows.map((row) => ({
        id: row.id,
        number: row.number,
        reference: row.reference,
        date: fromDbDate(row.date),
        description: row.description,
        source: row.source,
        kind: row.kind,
        status: row.status,
        totalCents: toCents(row.total),
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        reversed: Boolean(row.reversedAt),
        reversalOfId: row.reversalOfId,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /** One entry with its lines, its source and who did what — the drill-down. */
  async detail(ctx: AccountingContext, entryId: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id: entryId, dealerId: ctx.dealerId },
      include: {
        lines: {
          orderBy: { lineNo: 'asc' },
          include: {
            account: { select: { id: true, code: true, name: true } },
            vehicle: {
              select: {
                id: true,
                vin: true,
                year: true,
                make: true,
                model: true,
                stockNumber: true,
              },
            },
            customer: { select: { id: true, name: true } },
            vendor: { select: { id: true, name: true } },
          },
        },
        reversedBy: { select: { id: true, reference: true } },
        reversalOf: { select: { id: true, reference: true } },
      },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    const people = await this.prisma.user.findMany({
      where: {
        id: { in: [entry.createdById, entry.postedById].filter((id): id is string => Boolean(id)) },
      },
      select: { id: true, firstName: true, lastName: true },
    });
    const name = (id: string | null) => {
      const person = people.find((candidate) => candidate.id === id);
      return person ? `${person.firstName} ${person.lastName}` : null;
    };
    const attachments = await this.prisma.accountingAttachment.findMany({
      where: { dealerId: ctx.dealerId, entityType: 'JournalEntry', entityId: entry.id },
      select: { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true },
    });
    return {
      id: entry.id,
      number: entry.number,
      reference: entry.reference,
      date: fromDbDate(entry.date),
      description: entry.description,
      memo: entry.memo,
      source: entry.source,
      kind: entry.kind,
      status: entry.status,
      totalCents: toCents(entry.total),
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      createdBy: name(entry.createdById),
      createdAt: entry.createdAt.toISOString(),
      postedBy: name(entry.postedById),
      postedAt: entry.postedAt?.toISOString() ?? null,
      reversedAt: entry.reversedAt?.toISOString() ?? null,
      reversalReason: entry.reversalReason,
      reversedBy: entry.reversedBy,
      reversalOf: entry.reversalOf,
      attachments: attachments.map((file) => ({
        ...file,
        createdAt: file.createdAt.toISOString(),
      })),
      lines: entry.lines.map((line) => ({
        id: line.id,
        lineNo: line.lineNo,
        account: line.account,
        debitCents: toCents(line.debit),
        creditCents: toCents(line.credit),
        description: line.description,
        vehicle: line.vehicle,
        customer: line.customer,
        vendor: line.vendor,
        costCategory: line.costCategory,
        taxType: line.taxType,
        reconciled: Boolean(line.reconciliationId),
      })),
    };
  }

  /** A manual entry: posted now (accounting.post) or kept as a draft. */
  async create(ctx: AccountingContext, input: JournalCreateInput) {
    if (input.post && !ctx.permissions.has('accounting.post')) {
      throw new BadRequestException(
        'You can save this as a draft; posting needs the post permission',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const entry = await this.posting.post(tx, ctx, {
        date: input.date,
        description: input.description,
        memo: input.memo,
        source: input.kind === 'OPENING' ? 'OPENING_BALANCE' : 'MANUAL',
        kind: input.kind,
        status: input.post ? 'POSTED' : 'DRAFT',
        lines: input.lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          description: line.description,
          vehicleId: line.vehicleId,
          customerId: line.customerId,
          vendorId: line.vendorId,
        })),
      });
      return { id: entry.id, reference: entry.reference };
    });
  }

  /** Replaces a draft's contents. Posted entries are never edited. */
  async updateDraft(ctx: AccountingContext, entryId: string, input: JournalCreateInput) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id: entryId, dealerId: ctx.dealerId },
      });
      if (!entry) throw new NotFoundException('Journal entry not found');
      if (entry.status !== 'DRAFT') {
        throw new ConflictException(
          'A posted entry cannot be edited; reverse it or post an adjustment',
        );
      }
      const total = input.lines.reduce((sum, line) => sum + line.debit, 0);
      await tx.journalLine.deleteMany({ where: { entryId: entry.id } });
      await tx.journalEntry.update({
        where: { id: entry.id },
        data: {
          date: toDbDate(input.date),
          description: input.description,
          memo: input.memo,
          kind: input.kind,
          total: fromCents(total),
          lines: {
            create: input.lines.map((line, index) => ({
              dealerId: ctx.dealerId,
              lineNo: index + 1,
              accountId: line.accountId,
              debit: fromCents(line.debit),
              credit: fromCents(line.credit),
              description: line.description,
              vehicleId: line.vehicleId,
              customerId: line.customerId,
              vendorId: line.vendorId,
            })),
          },
        },
      });
      // Re-validated in full when the draft is posted.
      const accounts = await tx.acctAccount.count({
        where: { dealerId: ctx.dealerId, id: { in: input.lines.map((line) => line.accountId) } },
      });
      if (accounts !== new Set(input.lines.map((line) => line.accountId)).size) {
        throw new BadRequestException(
          'One of the accounts does not exist in this chart of accounts',
        );
      }
      await recordAudit(tx, ctx, {
        action: 'journal.draft_updated',
        entityType: 'JournalEntry',
        entityId: entry.id,
        after: { date: input.date, description: input.description, totalCents: total },
      });
      if (input.post) {
        if (!ctx.permissions.has('accounting.post')) {
          throw new BadRequestException('Posting needs the post permission');
        }
        await this.posting.postDraft(tx, ctx, entry.id);
      }
      return { id: entry.id, reference: entry.reference };
    });
  }

  async postDraft(ctx: AccountingContext, entryId: string) {
    return this.prisma.$transaction((tx) => this.posting.postDraft(tx, ctx, entryId));
  }

  /** A draft was never on the books, so it may be discarded. */
  async deleteDraft(ctx: AccountingContext, entryId: string) {
    await this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id: entryId, dealerId: ctx.dealerId },
      });
      if (!entry) throw new NotFoundException('Journal entry not found');
      if (entry.status !== 'DRAFT') {
        throw new ConflictException('Posted entries are never deleted; reverse it instead');
      }
      await tx.journalEntry.delete({ where: { id: entry.id } });
      await recordAudit(tx, ctx, {
        action: 'journal.draft_deleted',
        entityType: 'JournalEntry',
        entityId: entry.id,
        before: { reference: entry.reference, description: entry.description },
      });
    });
  }

  /**
   * Reverses a manual entry. Entries made by a business flow (a sale, a bill)
   * are reversed from that document, so the document's state follows.
   */
  async reverse(ctx: AccountingContext, entryId: string, input: JournalReverseInput) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id: entryId, dealerId: ctx.dealerId },
        select: { source: true, sourceType: true },
      });
      if (!entry) throw new NotFoundException('Journal entry not found');
      if (entry.source !== 'MANUAL' && entry.source !== 'OPENING_BALANCE' && entry.sourceType) {
        throw new ConflictException(
          `This entry belongs to a ${entry.sourceType}; reverse or void it there so the document stays in step`,
        );
      }
      const reversal = await this.posting.reverse(tx, ctx, entryId, input);
      return { id: reversal.id, reference: reversal.reference };
    });
  }
}
