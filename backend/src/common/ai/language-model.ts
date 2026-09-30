/**
 * The seam between Vintrax's assistants (the dealer help desk and the site
 * chat) and whichever language model writes their answers.
 *
 * An assistant knows nothing about any vendor: it hands over a system
 * prompt and the conversation and gets text back. A provider owns its SDK, its
 * credentials and its error handling, and is chosen once, at start-up, from
 * `AI_PROVIDER`. Adding another vendor is another class implementing this, and
 * a case in `languageModelFactory` (model-factory.ts).
 */
export interface HelpModelTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface HelpModelRequest {
  /** Stable across requests, so a provider may cache it. */
  system: string;
  messages: HelpModelTurn[];
}

export interface HelpModel {
  /** For logs only. Never includes a key. */
  readonly name: string;
  /**
   * The model's answer, or null when it declined or produced nothing usable.
   * Throws on transport or authentication failures; the caller falls back.
   */
  complete(request: HelpModelRequest): Promise<string | null>;
}

export const HELP_MODEL = Symbol('HELP_MODEL');
