import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AccountingContext } from './context';

type Tx = Prisma.TransactionClient;

type Counter =
  | 'nextSaleNumber'
  | 'nextBillNumber'
  | 'nextPaymentNumber'
  | 'nextExpenseNumber'
  | 'nextDepositNumber'
  | 'nextInvoiceNumber';

/** Allocates the next document number (and locks the dealer's settings row). */
export async function nextNumber(tx: Tx, dealerId: string, counter: Counter): Promise<number> {
  const settings = await tx.accountingSettings.update({
    where: { dealerId },
    data: { [counter]: { increment: 1 } },
    select: { [counter]: true } as Record<Counter, true>,
  });
  return (settings as Record<Counter, number>)[counter] - 1;
}

export async function nextInvoiceNumber(tx: Tx, dealerId: string): Promise<string> {
  const number = await nextNumber(tx, dealerId, 'nextInvoiceNumber');
  const { invoicePrefix } = await tx.accountingSettings.findUniqueOrThrow({
    where: { dealerId },
    select: { invoicePrefix: true },
  });
  return `${invoicePrefix}${number}`;
}

/**
 * Locks a vehicle row for the rest of the transaction, so two people cannot
 * sell (or buy) the same car at once. Also proves it is this dealer's.
 */
export async function lockDealerVehicle(tx: Tx, ctx: AccountingContext, vehicleId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Vehicle" WHERE "id" = ${vehicleId}::uuid AND "sellerId" = ${ctx.ownerUserId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new BadRequestException('Vehicle not found in your inventory');
  return tx.vehicle.findUniqueOrThrow({
    where: { id: vehicleId },
    select: {
      id: true,
      vin: true,
      year: true,
      make: true,
      model: true,
      condition: true,
      status: true,
      saleChannel: true,
      title: true,
    },
  });
}

export async function requireDealerVehicle(tx: Tx, ctx: AccountingContext, vehicleId: string) {
  const vehicle = await tx.vehicle.findFirst({
    where: { id: vehicleId, sellerId: ctx.ownerUserId },
    select: { id: true, vin: true, year: true, make: true, model: true, title: true, status: true },
  });
  if (!vehicle) throw new BadRequestException('Vehicle not found in your inventory');
  return vehicle;
}

export async function requireCustomer(tx: Tx, ctx: AccountingContext, customerId: string) {
  const customer = await tx.customer.findFirst({
    where: { id: customerId, dealerId: ctx.dealerId },
    select: { id: true, name: true, province: true, isActive: true },
  });
  if (!customer) throw new BadRequestException('Customer not found');
  return customer;
}

export async function requireVendor(tx: Tx, ctx: AccountingContext, vendorId: string) {
  const vendor = await tx.vendor.findFirst({
    where: { id: vendorId, dealerId: ctx.dealerId },
    select: { id: true, name: true, kind: true, paymentTermsDays: true, province: true },
  });
  if (!vendor) throw new BadRequestException('Vendor not found');
  return vendor;
}

export async function requireAccount(tx: Tx, ctx: AccountingContext, accountId: string) {
  const account = await tx.acctAccount.findFirst({
    where: { id: accountId, dealerId: ctx.dealerId },
    select: { id: true, name: true, type: true, subtype: true, systemKey: true, isActive: true },
  });
  if (!account) throw new BadRequestException('Account not found');
  if (!account.isActive) throw new BadRequestException(`${account.name} is inactive`);
  return account;
}

export async function dealerProvince(tx: Tx, dealerId: string) {
  const settings = await tx.accountingSettings.findUniqueOrThrow({
    where: { dealerId },
    select: { province: true, allowNegativeInventory: true },
  });
  return settings;
}

/** A vehicle still in stock already has a purchase on the books. */
export async function assertNotAlreadyInStock(tx: Tx, ctx: AccountingContext, vehicleId: string) {
  const acquisition = await tx.vehicleAcquisition.findFirst({
    where: { dealerId: ctx.dealerId, vehicleId, status: 'POSTED' },
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  if (!acquisition) return;
  const soldSince = await tx.vehicleSale.findFirst({
    where: {
      dealerId: ctx.dealerId,
      vehicleId,
      status: 'POSTED',
      saleDate: { gte: acquisition.date },
    },
    select: { id: true },
  });
  if (!soldSince) {
    throw new ConflictException(
      'This vehicle’s purchase is already recorded; add further costs as expenses',
    );
  }
}
