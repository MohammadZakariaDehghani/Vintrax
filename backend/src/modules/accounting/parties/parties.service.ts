import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CustomerInput, VendorInput } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { toCents } from '../core/money';

/** Customers (who buy) and vendors (who sell to the dealership, lend or bill it). */
@Injectable()
export class PartiesService {
  constructor(private readonly prisma: PrismaService) {}

  async customers(ctx: AccountingContext, query: { q?: string; page: number; pageSize: number }) {
    const where: Prisma.CustomerWhereInput = {
      dealerId: ctx.dealerId,
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
              { phone: { contains: query.q } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const balances = await this.customerBalances(ctx, rows.map((row) => row.id));
    return {
      items: rows.map((row) => ({ ...customerView(row), balanceCents: balances.get(row.id) ?? 0 })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async customer(ctx: AccountingContext, customerId: string) {
    const row = await this.prisma.customer.findFirst({ where: { id: customerId, dealerId: ctx.dealerId } });
    if (!row) throw new NotFoundException('Customer not found');
    const balances = await this.customerBalances(ctx, [row.id]);
    return { ...customerView(row), balanceCents: balances.get(row.id) ?? 0 };
  }

  async createCustomer(ctx: AccountingContext, input: CustomerInput) {
    return this.prisma.$transaction(async (tx) => {
      if (input.userId) {
        const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
        if (!user) throw new BadRequestException('That Vintrax account does not exist');
      }
      const customer = await tx.customer.create({ data: { dealerId: ctx.dealerId, ...input } });
      await recordAudit(tx, ctx, { action: 'customer.created', entityType: 'Customer', entityId: customer.id, after: input });
      return customerView(customer);
    });
  }

  async updateCustomer(ctx: AccountingContext, customerId: string, input: Partial<CustomerInput> & { isActive?: boolean }) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.customer.findFirst({ where: { id: customerId, dealerId: ctx.dealerId } });
      if (!existing) throw new NotFoundException('Customer not found');
      const customer = await tx.customer.update({ where: { id: existing.id }, data: input });
      await recordAudit(tx, ctx, {
        action: 'customer.updated',
        entityType: 'Customer',
        entityId: customer.id,
        before: customerView(existing),
        after: customerView(customer),
      });
      return customerView(customer);
    });
  }

  async vendors(ctx: AccountingContext, query: { q?: string; kind?: string; page: number; pageSize: number }) {
    const where: Prisma.VendorWhereInput = {
      dealerId: ctx.dealerId,
      ...(query.kind ? { kind: query.kind as never } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.vendor.count({ where }),
      this.prisma.vendor.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const balances = await this.vendorBalances(ctx, rows.map((row) => row.id));
    return {
      items: rows.map((row) => ({ ...vendorView(row), balanceCents: balances.get(row.id) ?? 0 })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async createVendor(ctx: AccountingContext, input: VendorInput) {
    return this.prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.create({ data: { dealerId: ctx.dealerId, ...input } });
      await recordAudit(tx, ctx, { action: 'vendor.created', entityType: 'Vendor', entityId: vendor.id, after: input });
      return vendorView(vendor);
    });
  }

  async updateVendor(ctx: AccountingContext, vendorId: string, input: Partial<VendorInput> & { isActive?: boolean }) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.vendor.findFirst({ where: { id: vendorId, dealerId: ctx.dealerId } });
      if (!existing) throw new NotFoundException('Vendor not found');
      const vendor = await tx.vendor.update({ where: { id: existing.id }, data: input });
      await recordAudit(tx, ctx, {
        action: 'vendor.updated',
        entityType: 'Vendor',
        entityId: vendor.id,
        before: vendorView(existing),
        after: vendorView(vendor),
      });
      return vendorView(vendor);
    });
  }

  /** What each customer owes: their AR ledger balance (debit-positive). */
  private async customerBalances(ctx: AccountingContext, ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const ar = await this.prisma.acctAccount.findMany({
      where: { dealerId: ctx.dealerId, subtype: 'RECEIVABLE' },
      select: { id: true },
    });
    const rows = await this.prisma.journalLine.groupBy({
      by: ['customerId'],
      where: {
        dealerId: ctx.dealerId,
        customerId: { in: ids },
        accountId: { in: ar.map((account) => account.id) },
        entry: { status: 'POSTED' },
      },
      _sum: { debit: true, credit: true },
    });
    return new Map(rows.map((row) => [row.customerId!, toCents(row._sum.debit) - toCents(row._sum.credit)]));
  }

  /** What the dealership owes each vendor: their AP ledger balance (credit-positive). */
  private async vendorBalances(ctx: AccountingContext, ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const ap = await this.prisma.acctAccount.findMany({
      where: { dealerId: ctx.dealerId, subtype: 'PAYABLE' },
      select: { id: true },
    });
    const rows = await this.prisma.journalLine.groupBy({
      by: ['vendorId'],
      where: {
        dealerId: ctx.dealerId,
        vendorId: { in: ids },
        accountId: { in: ap.map((account) => account.id) },
        entry: { status: 'POSTED' },
      },
      _sum: { debit: true, credit: true },
    });
    return new Map(rows.map((row) => [row.vendorId!, toCents(row._sum.credit) - toCents(row._sum.debit)]));
  }
}

function customerView(row: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  userId: string | null;
  notes: string | null;
  isActive: boolean;
}) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    province: row.province,
    postalCode: row.postalCode,
    userId: row.userId,
    notes: row.notes,
    isActive: row.isActive,
  };
}

function vendorView(row: {
  id: string;
  name: string;
  kind: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  province: string | null;
  gstNumber: string | null;
  paymentTermsDays: number;
  notes: string | null;
  isActive: boolean;
}) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    email: row.email,
    phone: row.phone,
    address: row.address,
    province: row.province,
    gstNumber: row.gstNumber,
    paymentTermsDays: row.paymentTermsDays,
    notes: row.notes,
    isActive: row.isActive,
  };
}
