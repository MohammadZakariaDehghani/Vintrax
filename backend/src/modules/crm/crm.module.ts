import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AutomationsService } from './automation/automations.service';
import { AutomationEngine } from './automation/engine.service';
import { CrmScheduler } from './automation/scheduler.service';
import { CrmEmailController } from './controllers/email.controller';
import { CrmLeadsController } from './controllers/leads.controller';
import { SupportPortalController } from './controllers/portal.controller';
import { CrmPublicController } from './controllers/public.controller';
import { CrmSettingsController } from './controllers/settings.controller';
import { SupportController } from './controllers/support.controller';
import { CrmWorkController } from './controllers/work.controller';
import { CrmAccessService } from './core/access.service';
import { CrmBus } from './core/bus';
import { CrmConfigService } from './core/config.service';
import { CrmGuard } from './core/crm.guard';
import { CrmNotifyService } from './core/notify.service';
import { CrmSetupService } from './core/setup.service';
import { CampaignsService } from './email/campaigns.service';
import { ComplianceService } from './email/compliance.service';
import { DispatcherService } from './email/dispatcher.service';
import { EmailsService } from './email/emails.service';
import { OutboxService } from './email/outbox.service';
import { TemplatesService } from './email/templates.service';
import { CrmEventsWorker } from './events/crm-events.worker';
import { AssignmentService } from './leads/assignment.service';
import { LeadImportService } from './leads/import.service';
import { LeadsService } from './leads/leads.service';
import { ScoringService } from './leads/scoring.service';
import { CrmReportsService } from './reports/reports.service';
import { SupportInsightsService } from './support/insights.service';
import { SupportAdminService } from './support/support-admin.service';
import { TicketsService } from './support/tickets.service';
import { WorkService } from './work/work.service';

export const CRM_PROVIDERS = [
  CrmBus,
  CrmAccessService,
  CrmGuard,
  CrmSetupService,
  CrmNotifyService,
  CrmConfigService,
  ScoringService,
  AssignmentService,
  LeadsService,
  LeadImportService,
  WorkService,
  ComplianceService,
  OutboxService,
  DispatcherService,
  TemplatesService,
  EmailsService,
  CampaignsService,
  TicketsService,
  SupportAdminService,
  SupportInsightsService,
  AutomationEngine,
  AutomationsService,
  CrmScheduler,
  CrmEventsWorker,
  CrmReportsService,
];

/**
 * The CRM (D-066): a domain module inside the Vintrax monolith, on the same
 * database, users, dealers, vehicles, customers and sales, and the platform's
 * mail, queue and notification services. Two CRMs share it — the Dealer CRM
 * (/api/crm) and the Admin support CRM (/api/admin/crm, /api/support) — and
 * never each other's data.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [
    CrmLeadsController,
    CrmWorkController,
    CrmEmailController,
    CrmSettingsController,
    CrmPublicController,
    SupportController,
    SupportPortalController,
  ],
  providers: CRM_PROVIDERS,
  exports: [TicketsService, DispatcherService],
})
export class CrmModule {}
