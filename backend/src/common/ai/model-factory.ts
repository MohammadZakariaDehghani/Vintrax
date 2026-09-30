import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { AnthropicHelpModel } from './anthropic-model';
import type { HelpModel } from './language-model';
import { OpenAiCompatibleModel } from './openai-compatible-model';

/**
 * The providers with a known endpoint and a sensible default model. `AI_MODEL`
 * and `AI_BASE_URL` override either; free-tier model names change, so check
 * the provider's current list when setting one up.
 */
export const AI_PROVIDER_DEFAULTS = {
  anthropic: { baseUrl: null, model: 'claude-opus-5-5' },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
  },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  'openai-compatible': { baseUrl: null, model: null },
} as const;

/**
 * The language model the assistants answer with, from `AI_PROVIDER`, or null
 * when none is configured — in which case each assistant answers from its own
 * written articles instead.
 */
export function languageModelFactory(
  config: ConfigService<Env, true>,
  logContext = 'AI',
): HelpModel | null {
  const provider = config.get('AI_PROVIDER', { infer: true });
  const apiKey = config.get('AI_API_KEY', { infer: true })?.trim();
  if (provider === 'none' || !apiKey) return null;

  const defaults = AI_PROVIDER_DEFAULTS[provider];
  const model = config.get('AI_MODEL', { infer: true }) ?? defaults.model;
  const timeout = config.get('AI_TIMEOUT_MS', { infer: true });
  let created: HelpModel | null = null;

  if (provider === 'anthropic') {
    created = new AnthropicHelpModel(apiKey, model ?? defaults.model!, timeout);
  } else {
    const baseUrl = config.get('AI_BASE_URL', { infer: true }) ?? defaults.baseUrl;
    if (baseUrl && model) {
      created = new OpenAiCompatibleModel(apiKey, baseUrl, model, timeout, provider);
    }
  }

  if (created) new Logger(logContext).log(`Answers with ${created.name}`);
  return created;
}
