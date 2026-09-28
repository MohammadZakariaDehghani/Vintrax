import Anthropic from '@anthropic-ai/sdk';
import type { HelpModel, HelpModelRequest } from './help-model';

/**
 * Models that accept `output_config.effort` and the server-side refusal
 * fallback. Another model named in `AI_MODEL` still works; it is sent the
 * request without those two fields.
 */
const CURRENT_GENERATION = /^claude-(opus-5|sonnet-5-5|fable-5-1)/;

/** A help answer is a few short paragraphs; this is room for that and no more. */
const MAX_TOKENS = 1024;

/**
 * Writes help answers with Claude, through the official SDK.
 *
 * Constructed only on the server, from `AI_API_KEY`; the key never leaves this
 * object and is never logged or returned.
 */
export class AnthropicHelpModel implements HelpModel {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
    timeoutMs: number,
  ) {
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
    this.name = `anthropic:${model}`;
  }

  async complete(request: HelpModelRequest): Promise<string | null> {
    const current = CURRENT_GENERATION.test(this.model);

    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      // The system prompt is the whole help library and the rules, identical on
      // every request, so it is cached; the conversation after it is not.
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      messages: request.messages.map((turn) => ({ role: turn.role, content: turn.content })),
      ...(current
        ? {
            // Looking up a help article is not hard reasoning.
            output_config: { effort: 'low' as const },
            // If the model declines a request, the API retries it on a
            // fallback model within the same call rather than failing it.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default' as const,
          }
        : {}),
    });

    if (response.stop_reason === 'refusal') return null;

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();
    return text.length > 0 ? text : null;
  }
}
