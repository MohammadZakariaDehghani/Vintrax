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
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  assignmentRuleSchema,
  automationEnrollSchema,
  automationSchema,
  crmRangeQuerySchema,
  crmSettingsSchema,
  leadSourceSchema,
  leadStatusConfigSchema,
  leadStatusOrderSchema,
  notificationPrefsSchema,
  scoringSchema,
  tagSchema,
  type AssignmentRuleInput,
  type AutomationInput,
  type CrmRangeQuery,
  type CrmSettingsInput,
  type LeadSourceInput,
  type LeadStatusConfigInput,
  type NotificationPrefsInput,
  type ScoringInput,
  type TagInput,
} from '@vintrax/shared';
import { z } from 'zod';
import { zodBody, zodQuery } from '../../../common/pipes/zod-validation.pipe';
import { AutomationsService, type AutomationOwner } from '../automation/automations.service';
import { CrmScheduler } from '../automation/scheduler.service';
import { CrmConfigService } from '../core/config.service';
import { Crm, RequireCrm, type CrmContext } from '../core/context';
import { CrmGuard } from '../core/crm.guard';
import { CrmReportsService } from '../reports/reports.service';

const activeSchema = z.object({ isActive: z.boolean() });
const teamSchema = z.object({ team: z.string().trim().max(60).nullable() });
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
const enrollmentQuerySchema = z.object({ status: z.enum(['ACTIVE', 'WAITING', 'COMPLETED', 'STOPPED', 'FAILED']).optional() });

function owner(ctx: CrmContext): AutomationOwner {
  return { scope: 'DEALER', dealerId: ctx.dealerId, actor: { id: ctx.userId, email: ctx.actorEmail }, ctx };
}

/** Dealer CRM: automations, reports, settings, notification preferences and the audit log. */
@ApiTags('crm')
@Controller('crm')
@UseGuards(CrmGuard)
@RequireCrm('crm.view')
export class CrmSettingsController {
  constructor(
    private readonly config: CrmConfigService,
    private readonly automations: AutomationsService,
    private readonly reports: CrmReportsService,
    private readonly scheduler: CrmScheduler,
  ) {}

  // --- Automations -----------------------------------------------------------------------

  @Get('automations')
  @ApiOperation({ summary: 'Automations with enrollment and email results' })
  automationList(@Crm() ctx: CrmContext) {
    return this.automations.list({ scope: 'DEALER', dealerId: ctx.dealerId });
  }

  @Get('automations/:id')
  automation(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.automations.get({ scope: 'DEALER', dealerId: ctx.dealerId }, id);
  }

  @Post('automations')
  @RequireCrm('crm.automations')
  @ApiOperation({ summary: 'Create an automation' })
  createAutomation(@Crm() ctx: CrmContext, @Body(zodBody(automationSchema)) input: AutomationInput) {
    return this.automations.create(owner(ctx), input);
  }

  @Put('automations/:id')
  @RequireCrm('crm.automations')
  updateAutomation(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(automationSchema)) input: AutomationInput) {
    return this.automations.update(owner(ctx), id, input);
  }

  @Post('automations/:id/active')
  @RequireCrm('crm.automations')
  @ApiOperation({ summary: 'Turn an automation on or off (off stops running enrollments)' })
  setActive(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(activeSchema)) input: { isActive: boolean }) {
    return this.automations.setActive(owner(ctx), id, input.isActive);
  }

  @Delete('automations/:id')
  @RequireCrm('crm.automations')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAutomation(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.automations.remove(owner(ctx), id);
  }

  @Get('automations/:id/enrollments')
  enrollments(
    @Crm() ctx: CrmContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodQuery(enrollmentQuerySchema)) query: { status?: string },
  ) {
    return this.automations.enrollments({ scope: 'DEALER', dealerId: ctx.dealerId }, id, query.status);
  }

  @Post('automations/:id/enroll')
  @RequireCrm('crm.email')
  @ApiOperation({ summary: 'Start an automation for a lead by hand' })
  async enroll(
    @Crm() ctx: CrmContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(automationEnrollSchema)) input: z.infer<typeof automationEnrollSchema>,
  ) {
    const result = await this.automations.enroll(owner(ctx), id, { leadId: input.leadId });
    this.scheduler.kick();
    return result;
  }

  @Post('enrollments/:id/stop')
  @RequireCrm('crm.email')
  @ApiOperation({ summary: 'Stop a running automation for one lead' })
  async stopEnrollment(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.automations.stopEnrollment(owner(ctx), id);
    return { id };
  }

  @Post('enrollments/:id/retry')
  @RequireCrm('crm.automations')
  async retryEnrollment(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.automations.retryEnrollment(owner(ctx), id);
    this.scheduler.kick();
    return { id };
  }

  // --- Reports and audit -------------------------------------------------------------------

  @Get('reports')
  @RequireCrm('crm.reports')
  @ApiOperation({ summary: 'CRM reports for a date range' })
  reportsFor(@Crm() ctx: CrmContext, @Query(zodQuery(crmRangeQuerySchema)) query: CrmRangeQuery) {
    return this.reports.reports(ctx, query);
  }

  @Get('audit')
  @RequireCrm('crm.manage')
  @ApiOperation({ summary: 'The CRM audit log' })
  audit(@Crm() ctx: CrmContext, @Query(zodQuery(pageSchema)) query: z.infer<typeof pageSchema>) {
    return this.reports.auditLog(ctx, query.page, query.pageSize);
  }

  // --- Settings --------------------------------------------------------------------------

  @Put('settings')
  @RequireCrm('crm.settings')
  @ApiOperation({ summary: 'Business hours, follow-up targets, assignment, sender identity and consent defaults' })
  settings(@Crm() ctx: CrmContext, @Body(zodBody(crmSettingsSchema)) input: CrmSettingsInput) {
    return this.config.updateSettings(ctx, input);
  }

  @Get('statuses')
  statuses(@Crm() ctx: CrmContext) {
    return this.config.statuses(ctx);
  }

  @Post('statuses')
  @RequireCrm('crm.settings')
  createStatus(@Crm() ctx: CrmContext, @Body(zodBody(leadStatusConfigSchema)) input: LeadStatusConfigInput) {
    return this.config.createStatus(ctx, input);
  }

  @Put('statuses/order')
  @RequireCrm('crm.settings')
  reorder(@Crm() ctx: CrmContext, @Body(zodBody(leadStatusOrderSchema)) input: { ids: string[] }) {
    return this.config.reorderStatuses(ctx, input.ids);
  }

  @Put('statuses/:id')
  @RequireCrm('crm.settings')
  updateStatus(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(leadStatusConfigSchema)) input: LeadStatusConfigInput) {
    return this.config.updateStatus(ctx, id, input);
  }

  @Delete('statuses/:id')
  @RequireCrm('crm.settings')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteStatus(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.config.deleteStatus(ctx, id);
  }

  @Get('sources')
  sources(@Crm() ctx: CrmContext) {
    return this.config.sources(ctx);
  }

  @Post('sources')
  @RequireCrm('crm.settings')
  createSource(@Crm() ctx: CrmContext, @Body(zodBody(leadSourceSchema)) input: LeadSourceInput) {
    return this.config.createSource(ctx, input);
  }

  @Put('sources/:id')
  @RequireCrm('crm.settings')
  updateSource(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(leadSourceSchema)) input: LeadSourceInput) {
    return this.config.updateSource(ctx, id, input);
  }

  @Get('tags')
  tags(@Crm() ctx: CrmContext) {
    return this.config.tags(ctx);
  }

  @Post('tags')
  @RequireCrm('crm.manage')
  createTag(@Crm() ctx: CrmContext, @Body(zodBody(tagSchema)) input: TagInput) {
    return this.config.createTag(ctx, input);
  }

  @Put('tags/:id')
  @RequireCrm('crm.manage')
  updateTag(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(tagSchema)) input: TagInput) {
    return this.config.updateTag(ctx, id, input);
  }

  @Delete('tags/:id')
  @RequireCrm('crm.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTag(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.config.deleteTag(ctx, id);
  }

  @Get('scoring')
  scoring(@Crm() ctx: CrmContext) {
    return this.config.scoringRules(ctx);
  }

  @Put('scoring')
  @RequireCrm('crm.settings')
  @ApiOperation({ summary: 'Points per signal and the hot/warm thresholds' })
  updateScoring(@Crm() ctx: CrmContext, @Body(zodBody(scoringSchema)) input: ScoringInput) {
    return this.config.updateScoring(ctx, input);
  }

  @Get('assignment')
  assignment(@Crm() ctx: CrmContext) {
    return this.config.assignment(ctx);
  }

  @Post('assignment/rules')
  @RequireCrm('crm.settings')
  createRule(@Crm() ctx: CrmContext, @Body(zodBody(assignmentRuleSchema)) input: AssignmentRuleInput) {
    return this.config.createRule(ctx, input);
  }

  @Put('assignment/rules/:id')
  @RequireCrm('crm.settings')
  updateRule(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(assignmentRuleSchema)) input: AssignmentRuleInput) {
    return this.config.updateRule(ctx, id, input);
  }

  @Delete('assignment/rules/:id')
  @RequireCrm('crm.settings')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRule(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.config.deleteRule(ctx, id);
  }

  @Put('teams/:userId')
  @RequireCrm('crm.settings')
  @ApiOperation({ summary: 'Put a salesperson on a team (or none)' })
  setTeam(@Crm() ctx: CrmContext, @Param('userId', ParseUUIDPipe) userId: string, @Body(zodBody(teamSchema)) input: { team: string | null }) {
    return this.config.setTeam(ctx, userId, input.team);
  }

  @Get('notification-preferences')
  notificationPrefs(@Crm() ctx: CrmContext) {
    return this.config.notificationPrefs(ctx.userId);
  }

  @Put('notification-preferences')
  @ApiOperation({ summary: 'Your own CRM notification preferences' })
  setNotificationPrefs(@Crm() ctx: CrmContext, @Body(zodBody(notificationPrefsSchema)) input: NotificationPrefsInput) {
    return this.config.setNotificationPrefs(ctx.userId, input);
  }
}
