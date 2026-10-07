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
  campaignAudienceSchema,
  campaignSchema,
  consentSchema,
  emailComposeSchema,
  emailListQuerySchema,
  emailPreviewSchema,
  emailTemplateSchema,
  suppressionSchema,
  testEmailSchema,
  type CampaignAudience,
  type CampaignInput,
  type ConsentInput,
  type EmailComposeInput,
  type EmailListQuery,
  type EmailPreviewInput,
  type EmailTemplateInput,
} from '@vintrax/shared';
import { z } from 'zod';
import { zodBody, zodQuery } from '../../../common/pipes/zod-validation.pipe';
import { Crm, RequireCrm, type CrmContext } from '../core/context';
import { CrmGuard } from '../core/crm.guard';
import { CampaignsService } from '../email/campaigns.service';
import { EmailsService } from '../email/emails.service';
import { TemplatesService, type TemplateOwner } from '../email/templates.service';
import { CrmScheduler } from '../automation/scheduler.service';

const scheduleSchema = z.object({
  scheduledAt: z
    .union([z.literal(''), z.string().datetime({ offset: true })])
    .optional()
    .nullable()
    .transform((value) => (value ? new Date(value) : null)),
});
const restoreSchema = z.object({ version: z.coerce.number().int().min(1) });
const suppressionQuerySchema = z.object({ q: z.string().trim().max(100).optional() });

function owner(ctx: CrmContext): TemplateOwner {
  return { scope: 'DEALER', dealerId: ctx.dealerId, actor: { id: ctx.userId, email: ctx.actorEmail }, ctx };
}

/** Dealer CRM email: compose and schedule, the sent log, templates, campaigns, consent and suppression. */
@ApiTags('crm')
@Controller('crm')
@UseGuards(CrmGuard)
@RequireCrm('crm.view')
export class CrmEmailController {
  constructor(
    private readonly emails: EmailsService,
    private readonly templates: TemplatesService,
    private readonly campaigns: CampaignsService,
    private readonly scheduler: CrmScheduler,
  ) {}

  // --- Emails --------------------------------------------------------------------------

  @Get('emails')
  @ApiOperation({ summary: 'Sent, scheduled and failed emails' })
  list(@Crm() ctx: CrmContext, @Query(zodQuery(emailListQuerySchema)) query: EmailListQuery) {
    return this.emails.list(ctx, query);
  }

  @Get('emails/:id')
  @ApiOperation({ summary: 'One email with its delivery events' })
  get(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.emails.get(ctx, id);
  }

  @Post('emails')
  @RequireCrm('crm.email')
  @ApiOperation({ summary: 'Send or schedule an email to a lead (queued; sent in the background)' })
  async compose(@Crm() ctx: CrmContext, @Body(zodBody(emailComposeSchema)) input: EmailComposeInput) {
    const result = await this.emails.compose(ctx, input);
    this.scheduler.kick();
    return result;
  }

  @Post('emails/:id/cancel')
  @RequireCrm('crm.email')
  @ApiOperation({ summary: 'Cancel an email that has not been sent' })
  cancel(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.emails.cancel(ctx, id);
  }

  @Post('emails/:id/retry')
  @RequireCrm('crm.email')
  @ApiOperation({ summary: 'Queue a failed email again' })
  async retry(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.emails.retry(ctx, id);
    this.scheduler.kick();
    return result;
  }

  @Post('emails/:id/replied')
  @RequireCrm('crm.email')
  @ApiOperation({ summary: 'Record that the customer replied to this email' })
  replied(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.emails.markReplied(ctx, id);
  }

  @Post('email/preview')
  @ApiOperation({ summary: 'Render a subject and body with a lead’s (or sample) values' })
  preview(@Crm() ctx: CrmContext, @Body(zodBody(emailPreviewSchema)) input: EmailPreviewInput) {
    return this.templates.preview({ scope: 'DEALER', dealerId: ctx.dealerId }, input);
  }

  // --- Templates ---------------------------------------------------------------------------

  @Get('templates')
  @ApiOperation({ summary: 'Email templates' })
  templateList(@Crm() ctx: CrmContext) {
    return this.templates.list({ scope: 'DEALER', dealerId: ctx.dealerId });
  }

  @Get('templates/:id')
  @ApiOperation({ summary: 'One template with its version history' })
  template(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get({ scope: 'DEALER', dealerId: ctx.dealerId }, id);
  }

  @Post('templates')
  @RequireCrm('crm.templates')
  @ApiOperation({ summary: 'Create a template (HTML sanitised, variables checked)' })
  createTemplate(@Crm() ctx: CrmContext, @Body(zodBody(emailTemplateSchema)) input: EmailTemplateInput) {
    return this.templates.create(owner(ctx), input);
  }

  @Put('templates/:id')
  @RequireCrm('crm.templates')
  @ApiOperation({ summary: 'Update a template (keeps the previous version)' })
  updateTemplate(
    @Crm() ctx: CrmContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(emailTemplateSchema)) input: EmailTemplateInput,
  ) {
    return this.templates.update(owner(ctx), id, input);
  }

  @Post('templates/:id/restore')
  @RequireCrm('crm.templates')
  @ApiOperation({ summary: 'Restore an earlier version' })
  restore(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(restoreSchema)) input: { version: number }) {
    return this.templates.restore(owner(ctx), id, input.version);
  }

  @Delete('templates/:id')
  @RequireCrm('crm.templates')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a custom template' })
  async deleteTemplate(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.templates.remove(owner(ctx), id);
  }

  @Post('templates/test')
  @RequireCrm('crm.templates')
  @ApiOperation({ summary: 'Send a test to your own address, with sample values' })
  test(@Crm() ctx: CrmContext, @Body(zodBody(testEmailSchema)) input: z.infer<typeof testEmailSchema>) {
    return this.templates.sendTest(owner(ctx), input);
  }

  // --- Campaigns ---------------------------------------------------------------------------

  @Get('campaigns')
  @RequireCrm('crm.marketing')
  @ApiOperation({ summary: 'Marketing campaigns with their results' })
  campaignList(@Crm() ctx: CrmContext) {
    return this.campaigns.list(ctx);
  }

  @Post('campaigns/audience')
  @RequireCrm('crm.marketing')
  @ApiOperation({ summary: 'Who an audience filter reaches, and who is skipped (no consent, suppressed)' })
  audience(@Crm() ctx: CrmContext, @Body(zodBody(campaignAudienceSchema)) input: CampaignAudience) {
    return this.campaigns.preview(ctx, input);
  }

  @Get('campaigns/:id')
  @RequireCrm('crm.marketing')
  campaign(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.get(ctx, id);
  }

  @Post('campaigns')
  @RequireCrm('crm.marketing')
  @ApiOperation({ summary: 'Create a campaign (draft)' })
  createCampaign(@Crm() ctx: CrmContext, @Body(zodBody(campaignSchema)) input: CampaignInput) {
    return this.campaigns.create(ctx, input);
  }

  @Put('campaigns/:id')
  @RequireCrm('crm.marketing')
  updateCampaign(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(campaignSchema)) input: CampaignInput) {
    return this.campaigns.update(ctx, id, input);
  }

  @Post('campaigns/:id/schedule')
  @RequireCrm('crm.marketing')
  @ApiOperation({ summary: 'Send now or at a time (queued; consented leads only)' })
  async schedule(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(scheduleSchema)) input: { scheduledAt: Date | null }) {
    const result = await this.campaigns.schedule(ctx, id, input.scheduledAt);
    this.scheduler.kick();
    return result;
  }

  @Post('campaigns/:id/cancel')
  @RequireCrm('crm.marketing')
  cancelCampaign(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.cancel(ctx, id);
  }

  @Delete('campaigns/:id')
  @RequireCrm('crm.marketing')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCampaign(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.campaigns.remove(ctx, id);
  }

  // --- Consent and suppression ------------------------------------------------------------

  @Get('leads/:id/consents')
  @ApiOperation({ summary: 'A lead’s consent records' })
  consents(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.emails.consents(ctx, id);
  }

  @Post('consents')
  @ApiOperation({ summary: 'Record consent with its source (audited)' })
  recordConsent(@Crm() ctx: CrmContext, @Body(zodBody(consentSchema)) input: ConsentInput) {
    return this.emails.recordConsent(ctx, input);
  }

  @Post('consents/:id/withdraw')
  @ApiOperation({ summary: 'Withdraw a consent (audited)' })
  withdraw(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.emails.withdrawConsent(ctx, id);
  }

  @Get('suppressions')
  @ApiOperation({ summary: 'The suppression list: your dealership’s and the platform’s' })
  suppressions(@Crm() ctx: CrmContext, @Query(zodQuery(suppressionQuerySchema)) query: { q?: string }) {
    return this.emails.suppressions(ctx, query.q);
  }

  @Post('suppressions')
  @RequireCrm('crm.manage')
  @ApiOperation({ summary: 'Block an address from all email' })
  suppress(@Crm() ctx: CrmContext, @Body(zodBody(suppressionSchema)) input: z.infer<typeof suppressionSchema>) {
    return this.emails.suppress(ctx, input.email, input.note);
  }

  @Delete('suppressions/:id')
  @RequireCrm('crm.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsuppress(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.emails.unsuppress(ctx, id);
  }
}
