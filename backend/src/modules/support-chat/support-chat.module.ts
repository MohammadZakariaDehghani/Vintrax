import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { HELP_MODEL } from '../../common/ai/language-model';
import { languageModelFactory } from '../../common/ai/model-factory';
import { NotificationsModule } from '../notifications/notifications.module';
import { SupportChatController } from './support-chat.controller';
import { SupportChatService } from './support-chat.service';

@Module({
  imports: [NotificationsModule],
  controllers: [SupportChatController],
  providers: [
    SupportChatService,
    {
      provide: HELP_MODEL,
      useFactory: (config: ConfigService<Env, true>) =>
        languageModelFactory(config, 'SupportChatModule'),
      inject: [ConfigService],
    },
  ],
})
export class SupportChatModule {}
