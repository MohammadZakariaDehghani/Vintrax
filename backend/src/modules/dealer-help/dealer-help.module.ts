import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { languageModelFactory } from '../../common/ai/model-factory';
import { HELP_MODEL, type HelpModel } from '../../common/ai/language-model';
import { DealerHelpController } from './dealer-help.controller';
import { DealerHelpService } from './dealer-help.service';

/** Picks the language model from `AI_PROVIDER`, or none. */
export function helpModelFactory(config: ConfigService<Env, true>): HelpModel | null {
  return languageModelFactory(config, 'DealerHelpModule');
}

@Module({
  controllers: [DealerHelpController],
  providers: [
    DealerHelpService,
    { provide: HELP_MODEL, useFactory: helpModelFactory, inject: [ConfigService] },
  ],
})
export class DealerHelpModule {}
