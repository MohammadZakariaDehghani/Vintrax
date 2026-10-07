import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  activitySchema,
  crmRangeQuerySchema,
  leadAssignSchema,
  leadBulkSchema,
  leadImportSchema,
  leadListQuerySchema,
  leadMergeSchema,
  leadSchema,
  leadStatusChangeSchema,
  leadTagsSchema,
  timelineQuerySchema,
  type ActivityInput,
  type CrmRangeQuery,
  type LeadAssignInput,
  type LeadBulkInput,
  type LeadImportInput,
  type LeadInput,
  type LeadListQuery,
  type LeadStatusChangeInput,
} from '@vintrax/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { zodBody, zodQuery } from '../../../common/pipes/zod-validation.pipe';
import { CrmConfigService } from '../core/config.service';
import { Crm, RequireCrm, type CrmContext } from '../core/context';
import { CrmGuard } from '../core/crm.guard';
import { LeadImportService } from '../leads/import.service';
import { LeadsService, flattenTags, leadListSelect } from '../leads/leads.service';
import { CrmReportsService } from '../reports/reports.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

const searchQuerySchema = z.object({ q: z.string().trim().max(100).default('') });
const activityQuerySchema = z.object({
  type: z.string().trim().max(40).optional(),
  userId: z.string().uuid().optional(),
  people: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
const pageQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Dealer CRM: leads, the pipeline, the timeline, duplicates, import, search
 * and the overview. Every route resolves the caller's dealership on the
 * server (CrmGuard) and every query is filtered by it.
 */
@ApiTags('crm')
@Controller('crm')
@UseGuards(CrmGuard)
@RequireCrm('crm.view')
export class CrmLeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly imports: LeadImportService,
    private readonly reports: CrmReportsService,
    private readonly config: CrmConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'The dealership, the caller’s role and permissions, statuses, sources, tags and staff' })
  me(@Crm() ctx: CrmContext) {
    return this.config.overview(ctx);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'CRM overview for a date range' })
  dashboard(@Crm() ctx: CrmContext, @Query(zodQuery(crmRangeQuerySchema)) query: CrmRangeQuery) {
    return this.reports.dashboard(ctx, query);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search leads, customers, tasks, campaigns and vehicles' })
  search(@Crm() ctx: CrmContext, @Query(zodQuery(searchQuerySchema)) query: { q: string }) {
    return this.reports.search(ctx, query.q);
  }

  @Get('vehicles')
  @ApiOperation({ summary: 'The dealership’s inventory, for the vehicle-interest picker' })
  vehicles(@Crm() ctx: CrmContext, @Query(zodQuery(searchQuerySchema)) query: { q: string }) {
    const q = query.q;
    return this.prisma.vehicle.findMany({
      where: {
        sellerId: ctx.ownerUserId,
        status: { notIn: ['ARCHIVED'] },
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { vin: { contains: q.toUpperCase() } },
                { stockNumber: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, title: true, vin: true, stockNumber: true, priceCad: true, status: true },
    });
  }

  @Get('activities')
  @ApiOperation({ summary: 'Recent activity across your leads' })
  activities(@Crm() ctx: CrmContext, @Query(zodQuery(activityQuerySchema)) query: z.infer<typeof activityQuerySchema>) {
    return this.leads.activities(ctx, query);
  }

  @Get('customers')
  @ApiOperation({ summary: 'The dealership’s customers with their CRM lead' })
  customers(@Crm() ctx: CrmContext, @Query(zodQuery(pageQuerySchema)) query: z.infer<typeof pageQuerySchema>) {
    return this.reports.customers(ctx, query.q, query.page, query.pageSize);
  }

  // --- Leads ---------------------------------------------------------------------------

  @Get('leads')
  @ApiOperation({ summary: 'Leads, filtered and paginated' })
  list(@Crm() ctx: CrmContext, @Query(zodQuery(leadListQuerySchema)) query: LeadListQuery) {
    return this.leads.list(ctx, query);
  }

  @Get('leads/export')
  @RequireCrm('crm.view', 'crm.all_leads')
  @ApiOperation({ summary: 'The filtered lead list as CSV (audited)' })
  async export(
    @Crm() ctx: CrmContext,
    @Query(zodQuery(leadListQuerySchema)) query: LeadListQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const csv = await this.reports.exportLeads(ctx, query);
    response.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(Buffer.from(csv, 'utf8'));
  }

  @Get('pipeline')
  @ApiOperation({ summary: 'Leads grouped by pipeline status (the board)' })
  async pipeline(@Crm() ctx: CrmContext, @Query(zodQuery(searchQuerySchema)) query: { q: string }) {
    const statuses = await this.prisma.crmLeadStatus.findMany({
      where: { dealerId: ctx.dealerId, inPipeline: true, isActive: true },
      orderBy: { position: 'asc' },
    });
    const base = await this.leads.listWhere(ctx, { q: query.q || undefined, view: 'ALL' });
    const columns = await Promise.all(
      statuses.map(async (status) => {
        const where = { AND: [base, { statusId: status.id }] };
        const [count, leads] = await Promise.all([
          this.prisma.crmLead.count({ where }),
          this.prisma.crmLead.findMany({
            where,
            // The board shows the most recent; the list view has the rest.
            orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
            take: 50,
            select: leadListSelect,
          }),
        ]);
        return { status, count, leads: leads.map(flattenTags) };
      }),
    );
    return { columns };
  }

  @Post('leads')
  @ApiOperation({ summary: 'Create a lead (assigned by the dealership’s rules when no one is chosen)' })
  create(@Crm() ctx: CrmContext, @Body(zodBody(leadSchema)) input: LeadInput) {
    return this.leads.create(ctx, input, { sourceKey: input.sourceId ? undefined : 'MANUAL' });
  }

  @Post('leads/bulk')
  @RequireCrm('crm.manage')
  @ApiOperation({ summary: 'Assign, change status, tag or delete many leads' })
  bulk(@Crm() ctx: CrmContext, @Body(zodBody(leadBulkSchema)) input: LeadBulkInput) {
    return this.leads.bulk(ctx, input);
  }

  @Post('leads/import/preview')
  @RequireCrm('crm.manage')
  @ApiOperation({ summary: 'Validate a CSV and show what an import would do' })
  importPreview(@Crm() ctx: CrmContext, @Body(zodBody(leadImportSchema)) input: LeadImportInput) {
    return this.imports.preview(ctx, input);
  }

  @Post('leads/import')
  @RequireCrm('crm.manage')
  @ApiOperation({ summary: 'Import leads from CSV' })
  importLeads(@Crm() ctx: CrmContext, @Body(zodBody(leadImportSchema)) input: LeadImportInput) {
    return this.imports.commit(ctx, input);
  }

  @Get('leads/imports')
  @RequireCrm('crm.manage')
  @ApiOperation({ summary: 'Import history with error reports' })
  importHistory(@Crm() ctx: CrmContext) {
    return this.imports.history(ctx);
  }

  @Get('leads/:id')
  @ApiOperation({ summary: 'A lead with its tasks, appointments, automations, consent and journey' })
  get(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.get(ctx, id);
  }

  @Put('leads/:id')
  @ApiOperation({ summary: 'Update a lead' })
  update(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(leadSchema)) input: LeadInput) {
    return this.leads.update(ctx, id, input);
  }

  @Delete('leads/:id')
  @RequireCrm('crm.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a lead (audited)' })
  async remove(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.leads.remove(ctx, id);
  }

  @Post('leads/:id/status')
  @ApiOperation({ summary: 'Move a lead to another status (records the change on the timeline)' })
  status(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(leadStatusChangeSchema)) input: LeadStatusChangeInput) {
    return this.leads.changeStatus(ctx, id, input);
  }

  @Post('leads/:id/assign')
  @ApiOperation({ summary: 'Assign a lead (a salesperson may claim an unassigned one)' })
  assign(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(leadAssignSchema)) input: LeadAssignInput) {
    return this.leads.assign(ctx, id, input);
  }

  @Put('leads/:id/tags')
  @ApiOperation({ summary: 'Replace a lead’s tags' })
  tags(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(leadTagsSchema)) input: { tags: string[] }) {
    return this.leads.setTags(ctx, id, input.tags);
  }

  @Get('leads/:id/timeline')
  @ApiOperation({ summary: 'The lead’s unified timeline, newest first, a page at a time' })
  timeline(
    @Crm() ctx: CrmContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodQuery(timelineQuerySchema)) query: z.infer<typeof timelineQuerySchema>,
  ) {
    return this.leads.timeline(ctx, id, query);
  }

  @Post('leads/:id/activities')
  @ApiOperation({ summary: 'Log a call, note, meeting, test drive or other activity' })
  activity(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(activitySchema)) input: ActivityInput) {
    return this.leads.logActivity(ctx, id, input);
  }

  @Get('leads/:id/duplicates')
  @ApiOperation({ summary: 'Possible duplicates by email, phone, name or VIN' })
  duplicates(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.duplicates(ctx, id);
  }

  @Post('leads/:id/merge')
  @RequireCrm('crm.manage')
  @ApiOperation({ summary: 'Merge a duplicate into this lead, keeping all of its history' })
  merge(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(leadMergeSchema)) input: { duplicateId: string }) {
    return this.leads.merge(ctx, id, input.duplicateId);
  }

  @Post('leads/:id/convert')
  @ApiOperation({ summary: 'Make the lead a customer (the dealership’s Customer record)' })
  convert(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.convert(ctx, id);
  }
}
