import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  accountCreateSchema,
  accountUpdateSchema,
  dateInput,
  journalCreateSchema,
  journalReverseSchema,
  optionalReasonSchema,
  reasonSchema,
  reportQuerySchema,
  yearEndCloseSchema,
  type AccountCreateInput,
  type AccountUpdateInput,
  type JournalCreateInput,
  type JournalReverseInput,
  type ReportQuery,
} from '@vintrax/shared';
import { z } from 'zod';
import { zodBody, zodQuery } from '../../../common/pipes/zod-validation.pipe';
import { AccountsService } from '../accounts/accounts.service';
import { AccountingGuard } from '../core/accounting.guard';
import { Acct, RequireAccounting, assertPermission, type AccountingContext } from '../core/context';
import { JournalService } from '../journal/journal.service';
import { PeriodsService } from '../periods/periods.service';

const asOfQuerySchema = z.object({ asOf: dateInput.optional() });
const openYearSchema = z.object({ date: dateInput });

/** Chart of accounts, journal entries and fiscal periods. */
@ApiTags('accounting')
@Controller('dealer/accounting')
@UseGuards(AccountingGuard)
export class LedgerController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly journal: JournalService,
    private readonly periods: PeriodsService,
  ) {}

  // --- Chart of accounts -----------------------------------------------------------

  @Get('accounts')
  @RequireAccounting('accounting.view')
  @ApiOperation({ summary: 'Chart of accounts with balances' })
  listAccounts(@Acct() ctx: AccountingContext, @Query(zodQuery(asOfQuerySchema)) query: { asOf?: string }) {
    return this.accounts.list(ctx, query.asOf);
  }

  @Post('accounts')
  @RequireAccounting('accounting.manage_accounts')
  createAccount(@Acct() ctx: AccountingContext, @Body(zodBody(accountCreateSchema)) input: AccountCreateInput) {
    return this.accounts.create(ctx, input);
  }

  @Patch('accounts/:accountId')
  @RequireAccounting('accounting.manage_accounts')
  updateAccount(
    @Acct() ctx: AccountingContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body(zodBody(accountUpdateSchema)) input: AccountUpdateInput,
  ) {
    return this.accounts.update(ctx, accountId, input);
  }

  // --- Journal entries --------------------------------------------------------------

  @Get('journal')
  @RequireAccounting('accounting.view')
  @ApiOperation({ summary: 'Journal entries, filtered and paged' })
  listJournal(@Acct() ctx: AccountingContext, @Query(zodQuery(reportQuerySchema)) query: ReportQuery) {
    return this.journal.list(ctx, query);
  }

  @Get('journal/:entryId')
  @RequireAccounting('accounting.view')
  @ApiOperation({ summary: 'One entry with its lines, source document and attachments' })
  journalDetail(@Acct() ctx: AccountingContext, @Param('entryId', ParseUUIDPipe) entryId: string) {
    return this.journal.detail(ctx, entryId);
  }

  @Post('journal')
  @RequireAccounting('accounting.create')
  @ApiOperation({ summary: 'Create a manual journal entry (as a draft, or posted with `post: true`)' })
  async createJournal(@Acct() ctx: AccountingContext, @Body(zodBody(journalCreateSchema)) input: JournalCreateInput) {
    // Posting straight away needs the posting permission too.
    if (input.post) assertPermission(ctx, 'accounting.post');
    return this.journal.create(ctx, input);
  }

  @Patch('journal/:entryId')
  @RequireAccounting('accounting.edit')
  @ApiOperation({ summary: 'Change a draft entry (posted entries never change)' })
  updateJournal(
    @Acct() ctx: AccountingContext,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body(zodBody(journalCreateSchema)) input: JournalCreateInput,
  ) {
    return this.journal.updateDraft(ctx, entryId, input);
  }

  @Post('journal/:entryId/post')
  @RequireAccounting('accounting.post')
  postJournal(@Acct() ctx: AccountingContext, @Param('entryId', ParseUUIDPipe) entryId: string) {
    return this.journal.postDraft(ctx, entryId);
  }

  @Delete('journal/:entryId')
  @RequireAccounting('accounting.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft entry (posted entries are reversed, never deleted)' })
  async deleteJournal(@Acct() ctx: AccountingContext, @Param('entryId', ParseUUIDPipe) entryId: string) {
    await this.journal.deleteDraft(ctx, entryId);
  }

  @Post('journal/:entryId/reverse')
  @RequireAccounting('accounting.reverse')
  @ApiOperation({ summary: 'Reverse a posted manual entry with an equal and opposite entry' })
  reverseJournal(
    @Acct() ctx: AccountingContext,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body(zodBody(journalReverseSchema)) input: JournalReverseInput,
  ) {
    return this.journal.reverse(ctx, entryId, input);
  }

  // --- Fiscal years and periods -----------------------------------------------------

  @Get('periods')
  @RequireAccounting('accounting.view')
  listPeriods(@Acct() ctx: AccountingContext) {
    return this.periods.list(ctx);
  }

  @Post('fiscal-years')
  @RequireAccounting('accounting.close_period')
  @ApiOperation({ summary: 'Open the fiscal year containing a date' })
  openYear(@Acct() ctx: AccountingContext, @Body(zodBody(openYearSchema)) input: { date: string }) {
    return this.periods.openYear(ctx, input.date);
  }

  @Post('periods/:periodId/close')
  @RequireAccounting('accounting.close_period')
  closePeriod(
    @Acct() ctx: AccountingContext,
    @Param('periodId', ParseUUIDPipe) periodId: string,
    @Body(zodBody(optionalReasonSchema)) input: { reason?: string | null },
  ) {
    return this.periods.closePeriod(ctx, periodId, input.reason ?? null);
  }

  @Post('periods/:periodId/reopen')
  @RequireAccounting('accounting.reopen_period')
  @ApiOperation({ summary: 'Reopen a closed period (a reason is required and audited)' })
  reopenPeriod(
    @Acct() ctx: AccountingContext,
    @Param('periodId', ParseUUIDPipe) periodId: string,
    @Body(zodBody(reasonSchema)) input: { reason: string },
  ) {
    return this.periods.reopenPeriod(ctx, periodId, input.reason);
  }

  @Post('fiscal-years/:fiscalYearId/close')
  @RequireAccounting('accounting.close_period')
  @ApiOperation({ summary: 'Year-end close: post the closing entry to retained earnings' })
  closeYear(
    @Acct() ctx: AccountingContext,
    @Param('fiscalYearId', ParseUUIDPipe) fiscalYearId: string,
    @Body(zodBody(yearEndCloseSchema)) input: { reason?: string | null },
  ) {
    return this.periods.closeYear(ctx, fiscalYearId, input.reason ?? null);
  }

  @Post('fiscal-years/:fiscalYearId/reopen')
  @RequireAccounting('accounting.reopen_period')
  reopenYear(
    @Acct() ctx: AccountingContext,
    @Param('fiscalYearId', ParseUUIDPipe) fiscalYearId: string,
    @Body(zodBody(reasonSchema)) input: { reason: string },
  ) {
    return this.periods.reopenYear(ctx, fiscalYearId, input.reason);
  }
}
