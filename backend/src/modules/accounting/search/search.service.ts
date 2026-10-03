import { centsToDecimalString } from '@vintrax/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { fromDbDate, toDbDate } from '../core/dates';
import { toCents } from '../core/money';

export interface SearchHit {
  kind: 'vehicle' | 'customer' | 'vendor' | 'invoice' | 'bill' | 'journal' | 'payment' | 'account' | 'sale';
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

/**
 * One box for the books: a VIN, a customer or vendor, an invoice or journal
 * reference, a payment reference or number, an account, or a date.
 */
@Injectable()
export class AccountingSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: AccountingContext, q: string): Promise<SearchHit[]> {
    const text = q.trim();
    const contains = { contains: text, mode: 'insensitive' as const };
    const asNumber = /^\d{1,9}$/.test(text) ? Number(text) : null;
    const asDate = /^\d{4}-\d{2}-\d{2}$/.test(text) ? toDbDate(text) : null;
    const take = 8;

    const [vehicles, customers, vendors, invoices, bills, entries, payments, accounts, sales] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: { sellerId: ctx.ownerUserId, OR: [{ vin: contains }, { stockNumber: contains }] },
        select: { id: true, vin: true, year: true, make: true, model: true, stockNumber: true },
        take,
      }),
      this.prisma.customer.findMany({
        where: { dealerId: ctx.dealerId, OR: [{ name: contains }, { email: contains }, { phone: contains }] },
        select: { id: true, name: true, email: true },
        take,
      }),
      this.prisma.vendor.findMany({
        where: { dealerId: ctx.dealerId, OR: [{ name: contains }, { email: contains }] },
        select: { id: true, name: true, kind: true },
        take,
      }),
      this.prisma.customerInvoice.findMany({
        where: { dealerId: ctx.dealerId, OR: [{ number: contains }, ...(asDate ? [{ date: asDate }] : [])] },
        select: { id: true, number: true, total: true, customer: { select: { name: true } } },
        take,
      }),
      this.prisma.vendorBill.findMany({
        where: {
          dealerId: ctx.dealerId,
          OR: [{ vendorReference: contains }, ...(asNumber !== null ? [{ number: asNumber }] : []), ...(asDate ? [{ date: asDate }] : [])],
        },
        select: { id: true, number: true, vendorReference: true, total: true, vendor: { select: { name: true } } },
        take,
      }),
      this.prisma.journalEntry.findMany({
        where: {
          dealerId: ctx.dealerId,
          OR: [
            { reference: contains },
            { description: contains },
            ...(asDate ? [{ date: asDate }] : []),
            ...(/^[0-9a-f-]{36}$/i.test(text) ? [{ id: text }] : []),
          ],
        },
        select: { id: true, reference: true, description: true, date: true, total: true },
        orderBy: { date: 'desc' },
        take,
      }),
      this.prisma.payment.findMany({
        where: {
          dealerId: ctx.dealerId,
          OR: [{ reference: contains }, ...(asNumber !== null ? [{ number: asNumber }] : []), ...(asDate ? [{ date: asDate }] : [])],
        },
        select: { id: true, number: true, reference: true, amount: true, direction: true },
        take,
      }),
      this.prisma.acctAccount.findMany({
        where: { dealerId: ctx.dealerId, OR: [{ code: { startsWith: text } }, { name: contains }] },
        select: { id: true, code: true, name: true },
        take,
      }),
      asNumber !== null
        ? this.prisma.vehicleSale.findMany({
            where: { dealerId: ctx.dealerId, number: asNumber },
            select: { id: true, number: true, customer: { select: { name: true } } },
            take,
          })
        : Promise.resolve([]),
    ]);

    const money = (value: { toString(): string }) => `$${centsToDecimalString(toCents(value.toString()))}`;
    return [
      ...vehicles.map((v) => ({ kind: 'vehicle' as const, id: v.id, title: `${v.year} ${v.make} ${v.model}`, subtitle: v.vin ?? v.stockNumber, href: `/dealer/accounting/vehicles/${v.id}` })),
      ...customers.map((c) => ({ kind: 'customer' as const, id: c.id, title: c.name, subtitle: c.email, href: `/dealer/accounting/customers/${c.id}` })),
      ...vendors.map((v) => ({ kind: 'vendor' as const, id: v.id, title: v.name, subtitle: v.kind, href: `/dealer/accounting/vendors/${v.id}` })),
      ...invoices.map((i) => ({ kind: 'invoice' as const, id: i.id, title: `Invoice ${i.number}`, subtitle: `${i.customer.name} · ${money(i.total)}`, href: `/dealer/accounting/receivables?invoice=${i.id}` })),
      ...bills.map((b) => ({ kind: 'bill' as const, id: b.id, title: `Bill #${b.number}${b.vendorReference ? ` (${b.vendorReference})` : ''}`, subtitle: `${b.vendor.name} · ${money(b.total)}`, href: `/dealer/accounting/payables?bill=${b.id}` })),
      ...entries.map((e) => ({ kind: 'journal' as const, id: e.id, title: e.reference, subtitle: `${fromDbDate(e.date)} · ${e.description}`, href: `/dealer/accounting/journal/${e.id}` })),
      ...payments.map((p) => ({ kind: 'payment' as const, id: p.id, title: `Payment #${p.number}`, subtitle: `${p.direction === 'RECEIVED' ? 'In' : 'Out'} · ${money(p.amount)}${p.reference ? ` · ${p.reference}` : ''}`, href: `/dealer/accounting/payments?payment=${p.id}` })),
      ...accounts.map((a) => ({ kind: 'account' as const, id: a.id, title: `${a.code} ${a.name}`, subtitle: null, href: `/dealer/accounting/ledger?accountId=${a.id}` })),
      ...sales.map((s) => ({ kind: 'sale' as const, id: s.id, title: `Sale #${s.number}`, subtitle: s.customer.name, href: `/dealer/accounting/sales/${s.id}` })),
    ];
  }
}
