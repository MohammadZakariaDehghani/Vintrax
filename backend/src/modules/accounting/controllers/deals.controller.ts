import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  VENDOR_KINDS,
  acquisitionSchema,
  customerSchema,
  customerUpdateSchema,
  depositRefundSchema,
  depositSchema,
  reasonSchema,
  reportQuerySchema,
  saleSchema,
  tradeInSchema,
  vendorSchema,
  vendorUpdateSchema,
  type AcquisitionInput,
  type CustomerInput,
  type DepositInput,
  type DepositRefundInput,
  type ReportQuery,
  type SaleInput,
  type TradeInInput,
  type VendorInput,
} from '@vintrax/shared';
import { z } from 'zod';
import { zodBody, zodQuery } from '../../../common/pipes/zod-validation.pipe';
import { AccountingGuard } from '../core/accounting.guard';
import { Acct, RequireAccounting, assertPermission, type AccountingContext } from '../core/context';
import { AcquisitionsService } from '../inventory/acquisitions.service';
import { TradeInsService } from '../inventory/trade-ins.service';
import { PartiesService } from '../parties/parties.service';
import { DepositsService } from '../sales/deposits.service';
import { SalesService } from '../sales/sales.service';

const optionalId = z.string().uuid().optional().or(z.literal('').transform(() => undefined));
const partyQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  kind: z.enum(VENDOR_KINDS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const dealQuerySchema = z.object({
  customerId: optionalId,
  status: z.string().trim().max(30).optional(),
});
const vehicleQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  includeSold: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

/** Whether the caller may see costs and profit, not just the customer-facing deal. */
function seesFinancials(ctx: AccountingContext) {
  return ctx.permissions.has('accounting.view');
}

/**
 * The deal desk and inventory purchasing: customers, vendors, vehicle
 * purchases, trade-ins, deposits and sales. Sales staff get the customer-facing
 * parts (customers, deposits, trade-ins, draft deals); vehicle cost and gross
 * profit are only in responses for roles that can see the books.
 */
@ApiTags('accounting')
@Controller('dealer/accounting')
@UseGuards(AccountingGuard)
export class DealsController {
  constructor(
    private readonly parties: PartiesService,
    private readonly acquisitions: AcquisitionsService,
    private readonly tradeIns: TradeInsService,
    private readonly deposits: DepositsService,
    private readonly sales: SalesService,
  ) {}

  // --- Vehicles (picker) ----------------------------------------------------------

  @Get('vehicles')
  @RequireAccounting('accounting.sales')
  @ApiOperation({ summary: 'The dealership’s vehicles, for choosing one in a deal or purchase' })
  vehicles(@Acct() ctx: AccountingContext, @Query(zodQuery(vehicleQuerySchema)) query: { q?: string; includeSold: boolean }) {
    return this.sales.vehicleOptions(ctx, query.q, query.includeSold);
  }

  // --- Customers and vendors -----------------------------------------------------------

  @Get('customers')
  @RequireAccounting('accounting.sales')
  customers(@Acct() ctx: AccountingContext, @Query(zodQuery(partyQuerySchema)) query: z.infer<typeof partyQuerySchema>) {
    return this.parties.customers(ctx, query);
  }

  @Get('customers/:customerId')
  @RequireAccounting('accounting.sales')
  customer(@Acct() ctx: AccountingContext, @Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.parties.customer(ctx, customerId);
  }

  @Post('customers')
  @RequireAccounting('accounting.sales')
  createCustomer(@Acct() ctx: AccountingContext, @Body(zodBody(customerSchema)) input: CustomerInput) {
    return this.parties.createCustomer(ctx, input);
  }

  @Patch('customers/:customerId')
  @RequireAccounting('accounting.sales')
  updateCustomer(
    @Acct() ctx: AccountingContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body(zodBody(customerUpdateSchema)) input: Partial<CustomerInput> & { isActive?: boolean },
  ) {
    return this.parties.updateCustomer(ctx, customerId, input);
  }

  @Get('vendors')
  @RequireAccounting('accounting.view')
  vendors(@Acct() ctx: AccountingContext, @Query(zodQuery(partyQuerySchema)) query: z.infer<typeof partyQuerySchema>) {
    return this.parties.vendors(ctx, query);
  }

  @Post('vendors')
  @RequireAccounting('accounting.create')
  createVendor(@Acct() ctx: AccountingContext, @Body(zodBody(vendorSchema)) input: VendorInput) {
    return this.parties.createVendor(ctx, input);
  }

  @Patch('vendors/:vendorId')
  @RequireAccounting('accounting.edit')
  updateVendor(
    @Acct() ctx: AccountingContext,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Body(zodBody(vendorUpdateSchema)) input: Partial<VendorInput> & { isActive?: boolean },
  ) {
    return this.parties.updateVendor(ctx, vendorId, input);
  }

  // --- Vehicle purchases --------------------------------------------------------------

  @Get('acquisitions')
  @RequireAccounting('accounting.view')
  listAcquisitions(@Acct() ctx: AccountingContext, @Query(zodQuery(reportQuerySchema)) query: ReportQuery) {
    return this.acquisitions.list(ctx, query);
  }

  @Post('acquisitions')
  @RequireAccounting('accounting.create', 'accounting.post')
  @ApiOperation({ summary: 'Record a vehicle purchase into inventory (paid, on account or floor plan)' })
  createAcquisition(@Acct() ctx: AccountingContext, @Body(zodBody(acquisitionSchema)) input: AcquisitionInput) {
    return this.acquisitions.create(ctx, input);
  }

  @Post('acquisitions/:acquisitionId/void')
  @RequireAccounting('accounting.reverse')
  voidAcquisition(
    @Acct() ctx: AccountingContext,
    @Param('acquisitionId', ParseUUIDPipe) acquisitionId: string,
    @Body(zodBody(reasonSchema)) input: { reason: string },
  ) {
    return this.acquisitions.void(ctx, acquisitionId, input.reason);
  }

  // --- Trade-ins -------------------------------------------------------------------------

  @Get('trade-ins')
  @RequireAccounting('accounting.sales')
  listTradeIns(@Acct() ctx: AccountingContext, @Query(zodQuery(dealQuerySchema)) query: z.infer<typeof dealQuerySchema>) {
    return this.tradeIns.list(ctx, query);
  }

  @Post('trade-ins')
  @RequireAccounting('accounting.sales')
  @ApiOperation({ summary: 'Appraise a trade-in (it enters inventory when the sale posts)' })
  createTradeIn(@Acct() ctx: AccountingContext, @Body(zodBody(tradeInSchema)) input: TradeInInput) {
    return this.tradeIns.create(ctx, input);
  }

  @Post('trade-ins/:tradeInId/withdraw')
  @RequireAccounting('accounting.sales')
  withdrawTradeIn(@Acct() ctx: AccountingContext, @Param('tradeInId', ParseUUIDPipe) tradeInId: string) {
    return this.tradeIns.withdraw(ctx, tradeInId);
  }

  // --- Customer deposits ----------------------------------------------------------------

  @Get('deposits')
  @RequireAccounting('accounting.sales')
  listDeposits(@Acct() ctx: AccountingContext, @Query(zodQuery(dealQuerySchema)) query: z.infer<typeof dealQuerySchema>) {
    return this.deposits.list(ctx, query);
  }

  @Post('deposits')
  @RequireAccounting('accounting.post_sales')
  @ApiOperation({ summary: 'Receive a customer deposit (a liability until the sale)' })
  receiveDeposit(@Acct() ctx: AccountingContext, @Body(zodBody(depositSchema)) input: DepositInput) {
    return this.deposits.receive(ctx, input);
  }

  @Post('deposits/:depositId/refund')
  @RequireAccounting('accounting.post_sales', 'accounting.reverse')
  refundDeposit(
    @Acct() ctx: AccountingContext,
    @Param('depositId', ParseUUIDPipe) depositId: string,
    @Body(zodBody(depositRefundSchema)) input: DepositRefundInput,
  ) {
    return this.deposits.refund(ctx, depositId, input);
  }

  // --- Sales ---------------------------------------------------------------------------------

  @Get('sales')
  @RequireAccounting('accounting.sales')
  async listSales(@Acct() ctx: AccountingContext, @Query(zodQuery(reportQuerySchema)) query: ReportQuery) {
    const result = await this.sales.list(ctx, query);
    if (seesFinancials(ctx)) return result;
    return { ...result, items: result.items.map((item) => withoutCost(item)) };
  }

  @Get('sales/:saleId')
  @RequireAccounting('accounting.sales')
  async saleDetail(@Acct() ctx: AccountingContext, @Param('saleId', ParseUUIDPipe) saleId: string) {
    const sale = await this.sales.detail(ctx, saleId);
    return seesFinancials(ctx) ? sale : withoutCost(sale);
  }

  @Post('sales/quote')
  @RequireAccounting('accounting.sales')
  @ApiOperation({ summary: 'Work out a deal — taxes, trade-in, deposits, balance — without saving it' })
  async quoteSale(@Acct() ctx: AccountingContext, @Body(zodBody(saleSchema)) input: SaleInput) {
    const quote = await this.sales.quote(ctx, input);
    return seesFinancials(ctx) ? quote : withoutCost(quote);
  }

  @Post('sales/drafts')
  @RequireAccounting('accounting.sales')
  saveDraft(@Acct() ctx: AccountingContext, @Body(zodBody(saleSchema)) input: SaleInput) {
    return this.sales.saveDraft(ctx, input);
  }

  @Patch('sales/drafts/:saleId')
  @RequireAccounting('accounting.sales')
  updateDraft(
    @Acct() ctx: AccountingContext,
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @Body(zodBody(saleSchema)) input: SaleInput,
  ) {
    return this.sales.saveDraft(ctx, input, saleId);
  }

  @Delete('sales/drafts/:saleId')
  @RequireAccounting('accounting.sales')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDraft(@Acct() ctx: AccountingContext, @Param('saleId', ParseUUIDPipe) saleId: string) {
    await this.sales.deleteDraft(ctx, saleId);
  }

  @Post('sales/drafts/:saleId/post')
  @RequireAccounting('accounting.post_sales')
  postDraft(@Acct() ctx: AccountingContext, @Param('saleId', ParseUUIDPipe) saleId: string) {
    return this.sales.postDraft(ctx, saleId);
  }

  @Post('sales')
  @RequireAccounting('accounting.post_sales')
  @ApiOperation({ summary: 'Post a vehicle sale: one transaction for revenue, tax, cost of sale, trade-in and receivables' })
  postSale(@Acct() ctx: AccountingContext, @Body(zodBody(saleSchema)) input: SaleInput) {
    return this.sales.post(ctx, input);
  }

  @Post('sales/:saleId/reverse')
  @RequireAccounting('accounting.reverse')
  @ApiOperation({ summary: 'Reverse a posted sale (an equal and opposite entry; the vehicle returns to stock)' })
  reverseSale(
    @Acct() ctx: AccountingContext,
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @Body(zodBody(reasonSchema)) input: { reason: string },
  ) {
    assertPermission(ctx, 'accounting.post_sales');
    return this.sales.reverse(ctx, saleId, input.reason);
  }
}

/** Removes cost-of-sale and profit figures from a sale or quote. */
function withoutCost<T extends object>(value: T): T {
  const copy = { ...value } as Record<string, unknown>;
  for (const key of ['costOfSaleCents', 'grossProfitCents', 'grossMarginBasisPoints', 'journalEntryId', 'reversalEntryId']) {
    delete copy[key];
  }
  // The floor plan payoff is the vehicle's financed cost.
  if (Array.isArray(copy.warnings)) {
    copy.warnings = (copy.warnings as string[]).map((warning) =>
      warning.startsWith('This vehicle is floor-planned') ? 'This vehicle is floor-planned and must be paid off when it sells' : warning,
    );
  }
  return copy as T;
}
