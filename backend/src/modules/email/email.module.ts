import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { EmailAdminController } from './email-admin.controller';
import { EmailWebhookController } from './email-webhook.controller';

/**
 * The HTTP edges of platform email (D-068): the Resend delivery webhook and
 * Admin → Emails. Sending itself is the global MailService.
 */
@Module({
  imports: [CrmModule],
  controllers: [EmailWebhookController, EmailAdminController],
})
export class EmailModule {}
