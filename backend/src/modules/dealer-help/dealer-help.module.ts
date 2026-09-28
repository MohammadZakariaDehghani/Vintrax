import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { AnthropicHelpModel } from './anthropic-help-model';
import { DealerHelpController } from './dealer-help.controller';
import { DealerHelpService } from './dealer-help.service';
import { HELP_MODEL, type HelpModel } from './help-model';

/** Picks the language model from `AI_PROVIDER`, or none. */
export function helpModelFactory(config: ConfigService<Env, true>): HelpModel | null {
  const provider = config.get('AI_PROVIDER', { infer: true });
  const apiKey = config.get('AI_API_KEY', { infer: true })?.trim();
  if (provider === 'none' || !apiKey) return null;

  const model = config.get('AI_MODEL', { infer: true });
  const timeout = config.get('AI_TIMEOUT_MS', { infer: true });
  switch (provider) {
    case 'anthropic': {
      const helpModel = new AnthropicHelpModel(apiKey, model, timeout);
      new Logger('DealerHelpModule').log(`Help assistant answers with ${helpModel.name}`);
      return helpModel;
    }
    default:
      return null;
  }
}

@Module({
  controllers: [DealerHelpController],
  providers: [
    DealerHelpService,
    { provide: HELP_MODEL, useFactory: helpModelFactory, inject: [ConfigService] },
  ],
})
export class DealerHelpModule {}
