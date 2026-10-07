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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  adminTaskListQuerySchema,
  adminTaskSchema,
  automationEnrollSchema,
  automationSchema,
  crmRangeQuerySchema,
  directMessageSchema,
  emailPreviewSchema,
  emailTemplateSchema,
  supportCategorySchema,
  supportSettingsSchema,
  supportTeamSchema,
  testEmailSchema,
  ticketListQuerySchema,
  ticketMessageSchema,
  ticketSchema,
  ticketUpdateSchema,
  type AdminTaskInput,
  type AutomationInput,
  type CrmRangeQuery,
  type DirectMessageInput,
  type EmailPreviewInput,
  type EmailTemplateInput,
  type SupportSettingsInput,
  type TicketInput,
  type TicketListQuery,
  type TicketMessageInput,
  type TicketUpdateInput,
} from '@vintrax/shared';
import { z } from 'zod';
import type { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import { zodBody, zodQuery } from '../../../common/pipes/zod-validation.pipe';
import { AutomationsService, type AutomationOwner } from '../automation/automations.service';
import { CrmScheduler } from '../automation/scheduler.service';
import { CrmSetupService } from '../core/setup.service';
import { TemplatesService, type TemplateOwner } from '../email/templates.service';
import { SupportInsightsService } from '../support/insights.service';
import { SupportAdminService } from '../support/support-admin.service';
import { TicketsService } from '../support/tickets.service';

const searchSchema = z.object({ q: z.string().trim().max(100).optional() });
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
const activeSchema = z.object({ isActive: z.boolean() });

function actor(user: AuthUser) {
  return { id: user.id, email: user.email };
}
function templateOwner(user: AuthUser): TemplateOwner {
  return { scope: 'SUPPORT', dealerId: null, actor: actor(user) };
}
function automationOwner(user: AuthUser): AutomationOwner {
  return { scope: 'SUPPORT', dealerId: null, actor: actor(user) };
}

/**
 * The Admin CRM (support desk). Administrators with `support:manage` only;
 * nothing here is reachable by a dealer or a user. Internal notes are
 * returned on these routes and nowhere else.
 */
@ApiTags('admin-crm')
@Controller('admin/crm')
@RequirePermissions('support:manage')
export class SupportController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly admin: SupportAdminService,
    private readonly insights: SupportInsightsService,
    private readonly templates: TemplatesService,
    private readonly automations: AutomationsService,
    private readonly setup: CrmSetupService,
    private readonly scheduler: CrmScheduler,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Support desk overview' })
  async overview(@CurrentUser() user: AuthUser) {
    await this.setup.ensureSupport();
    return this.insights.overview(user.id);
  }

  @Get('reports')
  @ApiOperation({ summary: 'Support reports for a date range' })
  reports(@Query(zodQuery(crmRangeQuerySchema)) query: CrmRangeQuery) {
    return this.insights.reports(query);
  }

  // --- Tickets ----------------------------------------------------------------------------

  @Get('tickets')
  list(@CurrentUser() user: AuthUser, @Query(zodQuery(ticketListQuerySchema)) query: TicketListQuery) {
    return this.tickets.list(query, user.id);
  }

  @Post('tickets')
  @ApiOperation({ summary: 'Open a ticket on someone’s behalf' })
  async create(@CurrentUser() user: AuthUser, @Body(zodBody(ticketSchema)) input: TicketInput) {
    const ticket = await this.tickets.create(actor(user), input, 'ADMIN');
    this.scheduler.kick();
    return ticket;
  }

  @Post('tickets/from-chat/:chatId')
  @ApiOperation({ summary: 'Turn a site-chat conversation into a ticket' })
  fromChat(@CurrentUser() user: AuthUser, @Param('chatId', ParseUUIDPipe) chatId: string) {
    return this.tickets.fromSupportChat(actor(user), chatId);
  }

  @Get('tickets/:id')
  @ApiOperation({ summary: 'A ticket with its public messages, internal notes, events, tasks and emails' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.get(id);
  }

  @Put('tickets/:id')
  @ApiOperation({ summary: 'Change status, priority, category, assignee, team, due date or tags' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(ticketUpdateSchema)) input: TicketUpdateInput) {
    return this.tickets.update(actor(user), id, input);
  }

  @Post('tickets/:id/messages')
  @ApiOperation({ summary: 'Reply to the requester (PUBLIC, emailed) or add an internal note (INTERNAL, never shown to them)' })
  async message(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(ticketMessageSchema)) input: TicketMessageInput) {
    const message = await this.tickets.addMessage(actor(user), id, input);
    this.scheduler.kick();
    return message;
  }

  @Post('tickets/:id/assign-automatically')
  autoAssign(@Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.autoAssign(id);
  }

  // --- Admin tasks ---------------------------------------------------------------------------

  @Get('tasks')
  tasks(@CurrentUser() user: AuthUser, @Query(zodQuery(adminTaskListQuerySchema)) query: z.infer<typeof adminTaskListQuerySchema>) {
    return this.admin.listTasks(query, user.id);
  }

  @Post('tasks')
  createTask(@CurrentUser() user: AuthUser, @Body(zodBody(adminTaskSchema)) input: AdminTaskInput) {
    return this.admin.createTask(actor(user), input);
  }

  @Put('tasks/:id')
  updateTask(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(adminTaskSchema)) input: AdminTaskInput) {
    return this.admin.updateTask(actor(user), id, input);
  }

  @Delete('tasks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTask(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.admin.deleteTask(actor(user), id);
  }

  // --- Dealer 360 / User 360 -------------------------------------------------------------------

  @Get('dealers')
  dealers(@Query(zodQuery(searchSchema)) query: { q?: string }) {
    return this.insights.dealers(query.q);
  }

  @Get('dealers/:id')
  @ApiOperation({ summary: 'Dealer 360' })
  dealer(@Param('id', ParseUUIDPipe) id: string) {
    return this.insights.dealer360(id);
  }

  @Get('users')
  users(@Query(zodQuery(searchSchema)) query: { q?: string }) {
    return this.insights.users(query.q);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'User 360' })
  user(@Param('id', ParseUUIDPipe) id: string) {
    return this.insights.user360(id);
  }

  // --- Communication ---------------------------------------------------------------------------

  @Post('messages')
  @ApiOperation({ summary: 'Message a user or a dealer by email and/or in the app' })
  async directMessage(@CurrentUser() user: AuthUser, @Body(zodBody(directMessageSchema)) input: DirectMessageInput) {
    const result = await this.insights.directMessage(actor(user), input);
    this.scheduler.kick();
    return result;
  }

  @Get('communication')
  communication(@Query(zodQuery(pageSchema)) query: z.infer<typeof pageSchema>) {
    return this.insights.communicationLog(query.page, query.pageSize);
  }

  @Get('audit')
  audit(@Query(zodQuery(pageSchema)) query: z.infer<typeof pageSchema>) {
    return this.insights.audit(query.page, query.pageSize);
  }

  // --- Settings --------------------------------------------------------------------------------

  @Get('settings')
  settings() {
    return this.admin.settings();
  }

  @Put('settings')
  @ApiOperation({ summary: 'SLA targets, waiting reminders, auto-close and the default team' })
  updateSettings(@CurrentUser() user: AuthUser, @Body(zodBody(supportSettingsSchema)) input: SupportSettingsInput) {
    return this.admin.updateSettings(actor(user), input);
  }

  @Post('categories')
  createCategory(@CurrentUser() user: AuthUser, @Body(zodBody(supportCategorySchema)) input: z.infer<typeof supportCategorySchema>) {
    return this.admin.createCategory(actor(user), input);
  }

  @Put('categories/:id')
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(supportCategorySchema)) input: z.infer<typeof supportCategorySchema>,
  ) {
    return this.admin.updateCategory(actor(user), id, input);
  }

  @Post('teams')
  createTeam(@CurrentUser() user: AuthUser, @Body(zodBody(supportTeamSchema)) input: z.infer<typeof supportTeamSchema>) {
    return this.admin.createTeam(actor(user), input);
  }

  @Put('teams/:id')
  updateTeam(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(supportTeamSchema)) input: z.infer<typeof supportTeamSchema>) {
    return this.admin.updateTeam(actor(user), id, input);
  }

  // --- Support templates and automations -------------------------------------------------------

  @Get('templates')
  async templateList() {
    await this.setup.ensureSupport();
    return this.templates.list({ scope: 'SUPPORT', dealerId: null });
  }

  @Get('templates/:id')
  template(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get({ scope: 'SUPPORT', dealerId: null }, id);
  }

  @Post('templates')
  createTemplate(@CurrentUser() user: AuthUser, @Body(zodBody(emailTemplateSchema)) input: EmailTemplateInput) {
    return this.templates.create(templateOwner(user), input);
  }

  @Put('templates/:id')
  updateTemplate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(emailTemplateSchema)) input: EmailTemplateInput) {
    return this.templates.update(templateOwner(user), id, input);
  }

  @Post('templates/preview')
  preview(@Body(zodBody(emailPreviewSchema)) input: EmailPreviewInput) {
    return this.templates.preview({ scope: 'SUPPORT', dealerId: null }, input);
  }

  @Post('templates/test')
  test(@CurrentUser() user: AuthUser, @Body(zodBody(testEmailSchema)) input: z.infer<typeof testEmailSchema>) {
    return this.templates.sendTest(templateOwner(user), input);
  }

  @Get('automations')
  async automationList() {
    await this.setup.ensureSupport();
    return this.automations.list({ scope: 'SUPPORT', dealerId: null });
  }

  @Get('automations/:id')
  automation(@Param('id', ParseUUIDPipe) id: string) {
    return this.automations.get({ scope: 'SUPPORT', dealerId: null }, id);
  }

  @Post('automations')
  createAutomation(@CurrentUser() user: AuthUser, @Body(zodBody(automationSchema)) input: AutomationInput) {
    return this.automations.create(automationOwner(user), input);
  }

  @Put('automations/:id')
  updateAutomation(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(automationSchema)) input: AutomationInput) {
    return this.automations.update(automationOwner(user), id, input);
  }

  @Post('automations/:id/active')
  setActive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(activeSchema)) input: { isActive: boolean }) {
    return this.automations.setActive(automationOwner(user), id, input.isActive);
  }

  @Get('automations/:id/enrollments')
  enrollments(@Param('id', ParseUUIDPipe) id: string) {
    return this.automations.enrollments({ scope: 'SUPPORT', dealerId: null }, id);
  }

  @Post('automations/:id/enroll')
  async enroll(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(automationEnrollSchema)) input: z.infer<typeof automationEnrollSchema>) {
    const result = await this.automations.enroll(automationOwner(user), id, { ticketId: input.ticketId });
    this.scheduler.kick();
    return result;
  }

  @Post('enrollments/:id/stop')
  async stopEnrollment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.automations.stopEnrollment(automationOwner(user), id);
    return { id };
  }
}
