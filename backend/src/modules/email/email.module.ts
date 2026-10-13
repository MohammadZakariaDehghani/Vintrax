import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { EmailAdminController } from './email-admin.controller';
import { EmailSettingsController } from './email-settings.controller';
import { EmailWebhookController } from './email-webhook.controller';

/**
 * The HTTP edges of platform email (D-068, D-069): the Resend delivery
 * webhook, Admin → Emails and Admin → Settings → Email. Sending itself is the global MailService.
 */
@Module({
  imports: [CrmModule],
  controllers: [EmailWebhookController, EmailAdminController, EmailSettingsController],
})
export class EmailModule {}
