import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  accountingSearchSchema,
  dateInput,
  exportQuerySchema,
  exportReportParamSchema,
  reportQuerySchema,
  savedReportFilterSchema,
  type ExportQuery,
  type ExportableReport,
  type ReportQuery,
  type SavedReportFilterInput,
} from '@vintrax/shared';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { zodBody, zodQuery } from '../../../common/pipes/zod-validation.pipe';
import { AttachmentsService } from '../attachments/attachments.service';
import { AccountingGuard } from '../core/accounting.guard';
import { Acct, RequireAccounting, type AccountingContext } from '../core/context';
import { todayIso } from '../core/dates';
import { ExportService } from '../export/export.service';
import { AccountingHealthService } from '../health/health.service';
import { OperationsReportsService } from '../reports/operations.service';
import { StatementsService } from '../reports/statements.service';
import { AccountingSearchService } from '../search/search.service';

const plQuerySchema = reportQuerySchema.extend({
  columns: z.enum(['TOTAL', 'MONTHLY']).default('TOTAL'),
});
const asOfSchema = z.object({ asOf: dateInput.optional() });
const monthlySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  compare: z.enum(['PREVIOUS_MONTH', 'SAME_MONTH_LAST_YEAR']).default('PREVIOUS_MONTH'),
});
const fiscalYearSchema = z.object({ which: z.enum(['CURRENT', 'PREVIOUS']).default('CURRENT') });
const auditQuerySchema = z.object({
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().uuid().optional(),
  action: z.string().trim().max(60).optional(),
  userId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const savedFilterQuerySchema = z.object({ report: z.string().trim().max(40).optional() });

/**
 * Financial statements, dealer reports, exports, the Accounting Health
 * check, search, the audit trail, attachments and saved report filters.
 * Everything here needs `accounting.view`: a salesperson sees none of it.
 */
@ApiTags('accounting')
@Controller('dealer/accounting')
@UseGuards(AccountingGuard)
export class ReportsController {
  constructor(
    private readonly statements: StatementsService,
    private readonly operations: OperationsReportsService,
    private readonly exporter: ExportService,
    private readonly health: AccountingHealthService,
    private readonly searcher: AccountingSearchService,
    private readonly attachments: AttachmentsService,
  ) {}

  // --- Dashboard and statements -------------------------------------------------------

  @Get('dashboard')
  @RequireAccounting('accounting.view')
  @ApiOperation({ summary: 'The accounting overview for a date range' })
  dashboard(
    @Acct() ctx: AccountingContext,
    @Query(zodQuery(reportQuerySchema)) query: ReportQuery,
  ) {
    return this.operations.dashboard(ctx, query);
  }

  @Get('reports/trial-balance')
  @RequireAccounting('accounting.view')
  trialBalance(
    @Acct() ctx: AccountingContext,
    @Query(zodQuery(reportQuerySchema)) query: ReportQuery,
  ) {
    return this.statements.trialBalance(ctx, query);
  }

  @Get('reports/general-ledger')
  @RequireAccounting('accounting.view')
  @ApiOperation({
    summary: 'Posted journal lines with filters; a running balance when one account is chosen',
  })
  generalLedger(
    @Acct() ctx: AccountingContext,
    @Query(zodQuery(reportQuerySchema)) query: ReportQuery,
  ) {
    return this.statements.generalLedger(ctx, query);
  }

  @Get('reports/profit-loss')
  @RequireAccounting('accounting.view')
  profitAndLoss(
    @Acct() ctx: AccountingContext,
    @Query(zodQuery(plQuerySchema)) query: ReportQuery & { columns: 'TOTAL' | 'MONTHLY' },
  ) {
    return this.statements.profitAndLoss(ctx, query);
  }

  @Get('reports/balance-sheet')
  @RequireAccounting('accounting.view')
  balanceSheet(
    @Acct() ctx: AccountingContext,
    @Query(zodQuery(reportQuerySchema)) query: ReportQuery,
  ) {
    return this.statements.balanceSheet(ctx, query);
  }

  @Get('reports/cash-flow')
  @RequireAccounting('accounting.view')
  cashFlow(@Acct() ctx: AccountingContext, @Query(zodQuery(reportQuerySchema)) query: ReportQuery) {
    return this.statements.cashFlow(ctx, query);
  }

  @Get('reports/ar-aging')
  @RequireAccounting('accounting.view')
  arAging(@Acct() ctx: AccountingContext, @Query(zodQuery(asOfSchema)) query: { asOf?: string }) {
    return this.operations.arAging(ctx, query.asOf);
  }

  @Get('reports/ap-aging')
  @RequireAccounting('accounting.view')
  apAging(@Acct() ctx: AccountingContext, @Query(zodQuery(asOfSchema)) query: { asOf?: string }) {
    return this.operations.apAging(ctx, query.asOf);
  }

  @Get('reports/vehicle-profitability')
  @RequireAccounting('accounting.view')
  vehicleProfitability(
    @Acct() ctx: AccountingContext,
    @Query(zodQuery(reportQuerySchema)) query: ReportQuery,
  ) {
    return this.operations.vehicleProfitability(ctx, query);
  }

  @Get('reports/inventory-valuation')
  @RequireAccounting('accounting.view')
  inventoryValuation(
    @Acct() ctx: AccountingContext,
    @Query(zodQuery(asOfSchema)) query: { asOf?: string },
  ) {
    return this.operations.inventoryValuation(ctx, query.asOf);
  }

  @Get('reports/kpis')
  @RequireAccounting('accounting.view')
  kpis(@Acct() ctx: AccountingContext, @Query(zodQuery(reportQuerySchema)) query: ReportQuery) {
    return this.operations.kpis(ctx, query);
  }

  @Get('reports/monthly')
  @RequireAccounting('accounting.view')
  monthly(
    @Acct() ctx: AccountingContext,
    @Query(zodQuery(monthlySchema)) query: z.infer<typeof monthlySchema>,
  ) {
    return this.operations.monthly(ctx, query.month ?? todayIso().slice(0, 7), query.compare);
  }

  @Get('reports/fiscal-year')
  @RequireAccounting('accounting.view')
  fiscalYear(
    @Acct() ctx: AccountingContext,
    @Query(zodQuery(fiscalYearSchema)) query: z.infer<typeof fiscalYearSchema>,
  ) {
    return this.operations.fiscalYear(ctx, query.which);
  }

  // --- Exports --------------------------------------------------------------------------------

  @Get('exports/:report')
  @RequireAccounting('accounting.view', 'accounting.export')
  @ApiOperation({ summary: 'Download a report as CSV, Excel (.xlsx) or PDF' })
  async exportReport(
    @Acct() ctx: AccountingContext,
    @Param('report', zodBody(exportReportParamSchema)) report: ExportableReport,
    @Query(zodQuery(exportQuerySchema)) query: ExportQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.exporter.export(ctx, report, query);
    response.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(file.body);
  }

  // --- Health and search ------------------------------------------------------------------------

  @Get('health')
  @RequireAccounting('accounting.view')
  @ApiOperation({
    summary: 'Accounting Health: unbalanced entries, mismatches, unreconciled items and more',
  })
  healthCheck(@Acct() ctx: AccountingContext) {
    return this.health.check(ctx);
  }

  @Get('search')
  @RequireAccounting('accounting.view')
  search(
    @Acct() ctx: AccountingContext,
    @Query(zodQuery(accountingSearchSchema)) query: { q: string },
  ) {
    return this.searcher.search(ctx, query.q);
  }

  // --- Audit trail --------------------------------------------------------------------------------

  @Get('audit')
  @RequireAccounting('accounting.view')
  audit(
    @Acct() ctx: AccountingContext,
    @Query(zodQuery(auditQuerySchema)) query: z.infer<typeof auditQuerySchema>,
  ) {
    return this.attachments.auditLog(ctx, query);
  }

  // --- Attachments ----------------------------------------------------------------------------------

  @Get('attachments/:entityType/:entityId')
  @RequireAccounting('accounting.view')
  listAttachments(
    @Acct() ctx: AccountingContext,
    // Checked against the attachable record types by the service.
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
  ) {
    return this.attachments.list(ctx, entityType, entityId);
  }

  @Post('attachments/:entityType/:entityId')
  @RequireAccounting('accounting.create')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Attach a receipt, invoice or statement (PDF, JPEG or PNG) to a record',
  })
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  uploadAttachment(
    @Acct() ctx: AccountingContext,
    // Checked against the attachable record types by the service.
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.attachments.upload(ctx, entityType, entityId, file);
  }

  @Get('attachments/:attachmentId')
  @RequireAccounting('accounting.view')
  @ApiOperation({
    summary: 'Download an attachment (only through this route, only to the same dealership)',
  })
  async downloadAttachment(
    @Acct() ctx: AccountingContext,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile | void> {
    const { location, fileName } = await this.attachments.open(ctx, attachmentId);
    if (location.kind === 'remote') {
      response.redirect(HttpStatus.FOUND, location.url);
      return;
    }
    response.set({
      'Content-Type': location.contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(createReadStream(location.path));
  }

  // --- Saved report filters -------------------------------------------------------------------------

  @Get('saved-filters')
  @RequireAccounting('accounting.view')
  savedFilters(
    @Acct() ctx: AccountingContext,
    @Query(zodQuery(savedFilterQuerySchema)) query: { report?: string },
  ) {
    return this.attachments.savedFilters(ctx, query.report);
  }

  @Post('saved-filters')
  @RequireAccounting('accounting.view')
  saveFilter(
    @Acct() ctx: AccountingContext,
    @Body(zodBody(savedReportFilterSchema)) input: SavedReportFilterInput,
  ) {
    return this.attachments.saveFilter(ctx, input);
  }

  @Delete('saved-filters/:filterId')
  @RequireAccounting('accounting.view')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteFilter(
    @Acct() ctx: AccountingContext,
    @Param('filterId', ParseUUIDPipe) filterId: string,
  ) {
    await this.attachments.deleteFilter(ctx, filterId);
  }
}
