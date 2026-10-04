import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SavedReportFilterInput } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../../common/storage/storage.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';

/** Records a file may be attached to, and how to prove the record is this dealer's. */
export const ATTACHABLE = [
  'JournalEntry',
  'VehicleAcquisition',
  'VehicleSale',
  'Expense',
  'VendorBill',
  'CustomerInvoice',
  'Payment',
  'BankReconciliation',
  'BankTransaction',
  'TaxFilingPeriod',
  'CustomerDeposit',
  'FloorPlanNote',
] as const;
export type AttachableType = (typeof ATTACHABLE)[number];

const MAX_ATTACHMENTS_PER_RECORD = 20;

/**
 * Receipts, auction invoices, bank statements, tax documents. Files go to the
 * private document storage — never a public URL — and are streamed back only
 * through the accounting API to the same dealership. Attachments are
 * evidence, so they are not deleted.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(ctx: AccountingContext, entityType: string, entityId: string) {
    await this.requireEntity(ctx, entityType, entityId);
    const rows = await this.prisma.accountingAttachment.findMany({
      where: { dealerId: ctx.dealerId, entityType, entityId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      fileName: row.fileName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async upload(
    ctx: AccountingContext,
    entityType: string,
    entityId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
  ) {
    await this.requireEntity(ctx, entityType, entityId);
    const existing = await this.prisma.accountingAttachment.count({
      where: { dealerId: ctx.dealerId, entityType, entityId },
    });
    if (existing >= MAX_ATTACHMENTS_PER_RECORD) {
      throw new BadRequestException(
        `A record can have at most ${MAX_ATTACHMENTS_PER_RECORD} attachments`,
      );
    }
    const stored = await this.storage.uploadDocument({
      folder: 'documents',
      buffer: file.buffer,
      contentType: file.mimetype,
      originalName: file.originalname,
    });
    const fileName = file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'attachment';
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.accountingAttachment.create({
        data: {
          dealerId: ctx.dealerId,
          entityType,
          entityId,
          fileName,
          contentType: file.mimetype,
          sizeBytes: file.size,
          url: stored.url,
          uploadedById: ctx.userId,
        },
      });
      await recordAudit(tx, ctx, {
        action: 'attachment.added',
        entityType,
        entityId,
        after: { attachmentId: row.id, fileName, sizeBytes: file.size },
      });
      return { id: row.id, fileName };
    });
  }

  async open(ctx: AccountingContext, attachmentId: string) {
    const row = await this.prisma.accountingAttachment.findFirst({
      where: { id: attachmentId, dealerId: ctx.dealerId },
    });
    if (!row) throw new NotFoundException('Attachment not found');
    return { location: this.storage.resolveStored(row.url), fileName: row.fileName };
  }

  private async requireEntity(ctx: AccountingContext, entityType: string, entityId: string) {
    if (!(ATTACHABLE as readonly string[]).includes(entityType)) {
      throw new BadRequestException('Files cannot be attached to that');
    }
    const where = { id: entityId, dealerId: ctx.dealerId };
    const delegates: Record<AttachableType, () => Promise<unknown>> = {
      JournalEntry: () => this.prisma.journalEntry.findFirst({ where, select: { id: true } }),
      VehicleAcquisition: () =>
        this.prisma.vehicleAcquisition.findFirst({ where, select: { id: true } }),
      VehicleSale: () => this.prisma.vehicleSale.findFirst({ where, select: { id: true } }),
      Expense: () => this.prisma.expense.findFirst({ where, select: { id: true } }),
      VendorBill: () => this.prisma.vendorBill.findFirst({ where, select: { id: true } }),
      CustomerInvoice: () => this.prisma.customerInvoice.findFirst({ where, select: { id: true } }),
      Payment: () => this.prisma.payment.findFirst({ where, select: { id: true } }),
      BankReconciliation: () =>
        this.prisma.bankReconciliation.findFirst({ where, select: { id: true } }),
      BankTransaction: () => this.prisma.bankTransaction.findFirst({ where, select: { id: true } }),
      TaxFilingPeriod: () => this.prisma.taxFilingPeriod.findFirst({ where, select: { id: true } }),
      CustomerDeposit: () => this.prisma.customerDeposit.findFirst({ where, select: { id: true } }),
      FloorPlanNote: () => this.prisma.floorPlanNote.findFirst({ where, select: { id: true } }),
    };
    const found = await delegates[entityType as AttachableType]();
    if (!found) throw new NotFoundException('Record not found');
  }

  // --- Audit trail and saved report filters (small, so they live here) ------

  async auditLog(
    ctx: AccountingContext,
    query: {
      entityType?: string;
      entityId?: string;
      action?: string;
      userId?: string;
      page: number;
      pageSize: number;
    },
  ) {
    const where = {
      dealerId: ctx.dealerId,
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.userId ? { actorId: query.userId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.accountingAuditLog.count({ where }),
      this.prisma.accountingAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        actorEmail: row.actorEmail,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        before: row.before,
        after: row.after,
        reason: row.reason,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async savedFilters(ctx: AccountingContext, report?: string) {
    const rows = await this.prisma.savedReportFilter.findMany({
      where: { dealerId: ctx.dealerId, userId: ctx.userId, ...(report ? { report } : {}) },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      report: row.report,
      filters: row.filters,
    }));
  }

  async saveFilter(ctx: AccountingContext, input: SavedReportFilterInput) {
    const row = await this.prisma.savedReportFilter.create({
      data: {
        dealerId: ctx.dealerId,
        userId: ctx.userId,
        name: input.name,
        report: input.report,
        filters: input.filters,
      },
    });
    return { id: row.id };
  }

  async deleteFilter(ctx: AccountingContext, id: string) {
    const result = await this.prisma.savedReportFilter.deleteMany({
      where: { id, dealerId: ctx.dealerId, userId: ctx.userId },
    });
    if (result.count === 0) throw new NotFoundException('Saved filter not found');
  }
}
