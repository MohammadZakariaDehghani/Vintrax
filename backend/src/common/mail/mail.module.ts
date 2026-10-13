import { Global, Module } from '@nestjs/common';
import { EmailSettingsService } from './email-settings.service';
import { MailService } from './mail.service';

@Global()
@Module({
  providers: [MailService, EmailSettingsService],
  exports: [MailService, EmailSettingsService],
})
export class MailModule {}
