import type { HelpModel, HelpModelRequest } from './language-model';

/** A chat answer is a few short paragraphs; this is room for that and no more. */
const MAX_TOKENS = 700;

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
}

/**
 * Any provider that speaks the OpenAI Chat Completions protocol, over plain
 * `fetch` — no SDK, no new dependency.
 *
 * That covers the free tiers Vintrax is meant to start on:
 *
 * - Google Gemini: https://generativelanguage.googleapis.com/v1beta/openai
 * - Groq:          https://api.groq.com/openai/v1
 * - OpenRouter's free models, a self-hosted Ollama, and others.
 *
 * The key is read from the server's environment, sent only as a bearer token
 * to the configured base URL, and never logged or returned.
 */
export class OpenAiCompatibleModel implements HelpModel {
  readonly name: string;
  private readonly endpoint: string;

  constructor(
    private readonly apiKey: string,
    baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    label = 'openai-compatible',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.name = `${label}:${model}`;
  }

  async complete(request: HelpModelRequest): Promise<string | null> {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: MAX_TOKENS,
        temperature: 0.3,
        messages: [
          { role: 'system', content: request.system },
          ...request.messages.map((turn) => ({ role: turn.role, content: turn.content })),
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      // The status is enough to act on (401 key, 429 quota); the body can echo the request.
      throw new Error(`${this.name} answered HTTP ${response.status}`);
    }

    const body = (await response.json()) as ChatCompletion;
    const choice = body.choices?.[0];
    if (choice?.finish_reason === 'content_filter') return null;
    const text = choice?.message?.content?.trim();
    return text ? text : null;
  }
}
