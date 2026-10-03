import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  bankAccountSchema,
  bankAccountUpdateSchema,
  bankTransactionSchema,
  billSchema,
  dateInput,
  expenseSchema,
  floorPlanNoteSchema,
  floorPlanPaymentSchema,
  invoiceSchema,
  moneyInput,
  paymentSchema,
  reasonSchema,
  reconciliationCompleteSchema,
  reconciliationLinesSchema,
  reconciliationStartSchema,
  recurringExpenseSchema,
  reportQuerySchema,
  type BankAccountInput,
  type BankTransactionInput,
  type BillInput,
  type ExpenseInput,
  type FloorPlanNoteInput,
  type FloorPlanPaymentInput,
  type InvoiceInput,
  type PaymentInput,
  type ReconciliationStartInput,
  type RecurringExpenseInput,
  type ReportQuery,
} from '@vintrax/shared';
import { z } from 'zod';
import { zodBody, zodQuery } from '../../../common/pipes/zod-validation.pipe';
import { BankingService } from '../banking/banking.service';
import { AccountingGuard } from '../core/accounting.guard';
import { Acct, RequireAccounting, type AccountingContext } from '../core/context';
import { todayIso } from '../core/dates';
import { ExpensesService } from '../expenses/expenses.service';
import { FloorPlanService } from '../floor-plan/floor-plan.service';
import { BillsService } from '../payables/bills.service';
import { PaymentsService } from '../payments/payments.service';
import { InvoicesService } from '../receivables/invoices.service';

const statementQuerySchema = z.object({ from: dateInput.optional(), to: dateInput.optional() });
const invoiceQuerySchema = reportQuerySchema.extend({
  openOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
const applyCreditSchema = z.object({ billId: z.string().uuid(), amount: moneyInput });
const activeSchema = z.object({ isActive: z.boolean() });
const bankQuerySchema = z.object({ bankAccountId: z.string().uuid().optional() });
const floorPlanQuerySchema = z.object({
  status: z.string().trim().max(20).optional(),
  lenderId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
});

/** Statements default to the year so far. */
function statementRange(query: { from?: string; to?: string }) {
  const to = query.to ?? todayIso();
  return { from: query.from ?? `${to.slice(0, 4)}-01-01`, to };
}

/**
 * Receivables, payables, payments, expenses, bank accounts, reconciliation
 * and the floor plan. Every money movement goes through the posting engine;
 * corrections are reversals, never edits or deletes.
 */
@ApiTags('accounting')
@Controller('dealer/accounting')
@UseGuards(AccountingGuard)
export class MoneyController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly bills: BillsService,
    private readonly payments: PaymentsService,
    private readonly expenses: ExpensesService,
    private readonly banking: BankingService,
    private readonly floorPlan: FloorPlanService,
  ) {}

  // --- Receivables ----------------------------------------------------------------------

  @Get('invoices')
  @RequireAccounting('accounting.view')
  listInvoices(@Acct() ctx: AccountingContext, @Query(zodQuery(invoiceQuerySchema)) query: ReportQuery & { openOnly?: boolean }) {
    return this.invoices.list(ctx, query);
  }

  @Post('invoices')
  @RequireAccounting('accounting.create', 'accounting.post')
  createInvoice(@Acct() ctx: AccountingContext, @Body(zodBody(invoiceSchema)) input: InvoiceInput) {
    return this.invoices.create(ctx, input);
  }

  @Post('invoices/:invoiceId/void')
  @RequireAccounting('accounting.reverse')
  voidInvoice(
    @Acct() ctx: AccountingContext,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body(zodBody(reasonSchema)) input: { reason: string },
  ) {
    return this.invoices.void(ctx, invoiceId, input.reason);
  }

  @Get('customers/:customerId/statement')
  @RequireAccounting('accounting.view')
  @ApiOperation({ summary: 'A customer statement: opening balance, invoices, payments, closing balance' })
  customerStatement(
    @Acct() ctx: AccountingContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query(zodQuery(statementQuerySchema)) query: { from?: string; to?: string },
  ) {
    const range = statementRange(query);
    return this.invoices.statement(ctx, customerId, range.from, range.to);
  }

  // --- Payables ---------------------------------------------------------------------------

  @Get('bills')
  @RequireAccounting('accounting.view')
  listBills(@Acct() ctx: AccountingContext, @Query(zodQuery(reportQuerySchema)) query: ReportQuery) {
    return this.bills.list(ctx, query);
  }

  @Post('bills')
  @RequireAccounting('accounting.create', 'accounting.post')
  @ApiOperation({ summary: 'Enter a vendor bill or credit note' })
  createBill(@Acct() ctx: AccountingContext, @Body(zodBody(billSchema)) input: BillInput) {
    return this.bills.create(ctx, input);
  }

  @Post('bills/:creditId/apply')
  @RequireAccounting('accounting.post')
  @ApiOperation({ summary: 'Apply a vendor credit note to one of that vendor’s bills' })
  applyCredit(
    @Acct() ctx: AccountingContext,
    @Param('creditId', ParseUUIDPipe) creditId: string,
    @Body(zodBody(applyCreditSchema)) input: { billId: string; amount: number },
  ) {
    return this.bills.applyCredit(ctx, creditId, input.billId, input.amount);
  }

  @Post('bills/:billId/void')
  @RequireAccounting('accounting.reverse')
  voidBill(
    @Acct() ctx: AccountingContext,
    @Param('billId', ParseUUIDPipe) billId: string,
    @Body(zodBody(reasonSchema)) input: { reason: string },
  ) {
    return this.bills.void(ctx, billId, input.reason);
  }

  @Get('vendors/:vendorId/statement')
  @RequireAccounting('accounting.view')
  vendorStatement(
    @Acct() ctx: AccountingContext,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Query(zodQuery(statementQuerySchema)) query: { from?: string; to?: string },
  ) {
    const range = statementRange(query);
    return this.bills.statement(ctx, vendorId, range.from, range.to);
  }

  // --- Payments ----------------------------------------------------------------------------

  @Get('payments')
  @RequireAccounting('accounting.view')
  listPayments(@Acct() ctx: AccountingContext, @Query(zodQuery(reportQuerySchema)) query: ReportQuery) {
    return this.payments.list(ctx, query);
  }

  @Post('payments')
  @RequireAccounting('accounting.create', 'accounting.post')
  @ApiOperation({ summary: 'Record a payment received or made, applied to invoices or bills' })
  createPayment(@Acct() ctx: AccountingContext, @Body(zodBody(paymentSchema)) input: PaymentInput) {
    return this.payments.create(ctx, input);
  }

  @Post('payments/:paymentId/reverse')
  @RequireAccounting('accounting.reverse')
  reversePayment(
    @Acct() ctx: AccountingContext,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body(zodBody(reasonSchema)) input: { reason: string },
  ) {
    return this.payments.reverse(ctx, paymentId, input.reason);
  }

  // --- Expenses ------------------------------------------------------------------------------

  @Get('expenses')
  @RequireAccounting('accounting.view')
  listExpenses(@Acct() ctx: AccountingContext, @Query(zodQuery(reportQuerySchema)) query: ReportQuery) {
    return this.expenses.list(ctx, query);
  }

  @Post('expenses')
  @RequireAccounting('accounting.create', 'accounting.post')
  @ApiOperation({ summary: 'Record an expense: operating, vehicle cost, cost of sales or capital' })
  createExpense(@Acct() ctx: AccountingContext, @Body(zodBody(expenseSchema)) input: ExpenseInput) {
    return this.expenses.create(ctx, input);
  }

  @Post('expenses/:expenseId/reverse')
  @RequireAccounting('accounting.reverse')
  reverseExpense(
    @Acct() ctx: AccountingContext,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @Body(zodBody(reasonSchema)) input: { reason: string },
  ) {
    return this.expenses.reverse(ctx, expenseId, input.reason);
  }

  @Get('recurring-expenses')
  @RequireAccounting('accounting.view')
  recurring(@Acct() ctx: AccountingContext) {
    return this.expenses.recurring(ctx);
  }

  @Post('recurring-expenses')
  @RequireAccounting('accounting.create')
  createRecurring(@Acct() ctx: AccountingContext, @Body(zodBody(recurringExpenseSchema)) input: RecurringExpenseInput) {
    return this.expenses.createRecurring(ctx, input);
  }

  @Patch('recurring-expenses/:id')
  @RequireAccounting('accounting.edit')
  setRecurringActive(
    @Acct() ctx: AccountingContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(activeSchema)) input: { isActive: boolean },
  ) {
    return this.expenses.setRecurringActive(ctx, id, input.isActive);
  }

  @Post('recurring-expenses/post-due')
  @RequireAccounting('accounting.create', 'accounting.post')
  @ApiOperation({ summary: 'Post every recurring expense that has come due' })
  postDueRecurring(@Acct() ctx: AccountingContext) {
    return this.expenses.postDueRecurring(ctx);
  }

  // --- Bank accounts ----------------------------------------------------------------------------

  @Get('bank-accounts')
  @RequireAccounting('accounting.view')
  bankAccounts(@Acct() ctx: AccountingContext) {
    return this.banking.accounts(ctx);
  }

  @Get('bank-accounts/options')
  @RequireAccounting('accounting.sales')
  @ApiOperation({ summary: 'Bank and cash accounts by name only, for taking a deposit' })
  async bankAccountOptions(@Acct() ctx: AccountingContext) {
    const accounts = await this.banking.accounts(ctx);
    return accounts
      .filter((account) => account.isActive)
      .map((account) => ({ id: account.id, name: account.name, type: account.type }));
  }

  @Post('bank-accounts')
  @RequireAccounting('accounting.manage_accounts')
  createBankAccount(@Acct() ctx: AccountingContext, @Body(zodBody(bankAccountSchema)) input: BankAccountInput) {
    return this.banking.createAccount(ctx, input);
  }

  @Patch('bank-accounts/:bankAccountId')
  @RequireAccounting('accounting.manage_accounts')
  updateBankAccount(
    @Acct() ctx: AccountingContext,
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @Body(zodBody(bankAccountUpdateSchema)) input: { name?: string; bankName?: string | null; isActive?: boolean },
  ) {
    return this.banking.updateAccount(ctx, bankAccountId, input);
  }

  @Get('bank-accounts/:bankAccountId/register')
  @RequireAccounting('accounting.view')
  @ApiOperation({ summary: 'Every posted movement in a bank account, with the running balance' })
  register(
    @Acct() ctx: AccountingContext,
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @Query(zodQuery(reportQuerySchema)) query: ReportQuery,
  ) {
    return this.banking.register(ctx, bankAccountId, query);
  }

  @Post('bank-transactions')
  @RequireAccounting('accounting.create', 'accounting.post')
  @ApiOperation({ summary: 'Record a deposit, withdrawal, fee, interest or transfer' })
  createBankTransaction(@Acct() ctx: AccountingContext, @Body(zodBody(bankTransactionSchema)) input: BankTransactionInput) {
    return this.banking.createTransaction(ctx, input);
  }

  @Post('bank-transactions/:transactionId/reverse')
  @RequireAccounting('accounting.reverse')
  reverseBankTransaction(
    @Acct() ctx: AccountingContext,
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
    @Body(zodBody(reasonSchema)) input: { reason: string },
  ) {
    return this.banking.reverseTransaction(ctx, transactionId, input.reason);
  }

  // --- Reconciliation ------------------------------------------------------------------------------

  @Get('reconciliations')
  @RequireAccounting('accounting.view')
  reconciliations(@Acct() ctx: AccountingContext, @Query(zodQuery(bankQuerySchema)) query: { bankAccountId?: string }) {
    return this.banking.reconciliations(ctx, query.bankAccountId);
  }

  @Post('reconciliations')
  @RequireAccounting('accounting.reconcile_bank')
  startReconciliation(@Acct() ctx: AccountingContext, @Body(zodBody(reconciliationStartSchema)) input: ReconciliationStartInput) {
    return this.banking.startReconciliation(ctx, input);
  }

  @Get('reconciliations/:reconciliationId')
  @RequireAccounting('accounting.view')
  reconciliation(@Acct() ctx: AccountingContext, @Param('reconciliationId', ParseUUIDPipe) reconciliationId: string) {
    return this.banking.reconciliation(ctx, reconciliationId);
  }

  @Patch('reconciliations/:reconciliationId/cleared')
  @RequireAccounting('accounting.reconcile_bank')
  @ApiOperation({ summary: 'Set which ledger lines the statement shows as cleared' })
  setCleared(
    @Acct() ctx: AccountingContext,
    @Param('reconciliationId', ParseUUIDPipe) reconciliationId: string,
    @Body(zodBody(reconciliationLinesSchema)) input: { clearedLineIds: string[] },
  ) {
    return this.banking.setCleared(ctx, reconciliationId, input.clearedLineIds);
  }

  @Post('reconciliations/:reconciliationId/complete')
  @RequireAccounting('accounting.reconcile_bank')
  @ApiOperation({ summary: 'Complete a reconciliation (the difference must be zero, or an authorized adjustment given)' })
  completeReconciliation(
    @Acct() ctx: AccountingContext,
    @Param('reconciliationId', ParseUUIDPipe) reconciliationId: string,
    @Body(zodBody(reconciliationCompleteSchema)) input: { adjustment?: { accountId: string; reason: string } | null },
  ) {
    return this.banking.completeReconciliation(ctx, reconciliationId, input.adjustment ?? null);
  }

  @Delete('reconciliations/:reconciliationId')
  @RequireAccounting('accounting.reconcile_bank')
  @HttpCode(HttpStatus.NO_CONTENT)
  async discardReconciliation(@Acct() ctx: AccountingContext, @Param('reconciliationId', ParseUUIDPipe) reconciliationId: string) {
    await this.banking.discardReconciliation(ctx, reconciliationId);
  }

  // --- Floor plan ---------------------------------------------------------------------------------------

  @Get('floor-plan')
  @RequireAccounting('accounting.view')
  async floorPlanNotes(@Acct() ctx: AccountingContext, @Query(zodQuery(floorPlanQuerySchema)) query: z.infer<typeof floorPlanQuerySchema>) {
    const [notes, summary] = await Promise.all([this.floorPlan.notes(ctx, query), this.floorPlan.summary(ctx)]);
    return { notes, summary };
  }

  @Post('floor-plan')
  @RequireAccounting('accounting.create', 'accounting.post')
  @ApiOperation({ summary: 'Floor-plan a vehicle already in inventory' })
  createFloorPlanNote(@Acct() ctx: AccountingContext, @Body(zodBody(floorPlanNoteSchema)) input: FloorPlanNoteInput) {
    return this.floorPlan.createNote(ctx, input);
  }

  @Post('floor-plan/:noteId/payments')
  @RequireAccounting('accounting.create', 'accounting.post')
  @ApiOperation({ summary: 'Pay principal, interest or the payoff on a floor-plan note' })
  payFloorPlan(
    @Acct() ctx: AccountingContext,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body(zodBody(floorPlanPaymentSchema)) input: FloorPlanPaymentInput,
  ) {
    return this.floorPlan.pay(ctx, noteId, input);
  }
}
