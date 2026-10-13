import { Resend } from 'resend';

/**
 * The Resend API, behind the same small surface the SMTP transport offers
 * (D-068). One client per process, created only when MAIL_DRIVER=resend.
 *
 * What it adds over a bare `resend.emails.send`:
 *  - a request-rate limit, because Resend rate-limits each team and a burst
 *    (a campaign, a backlog after an outage) would otherwise be refused;
 *  - the provider's error, classified: permanent (a bad address, a sender on an
 *    unverified domain, a revoked key) is not worth retrying; transient (rate
 *    limited, a 5xx, a network failure) is, after `retryAfterMs` if Resend said;
 *  - the idempotency key passed through, so a retry after a timeout cannot
 *    produce a second copy at Resend's end either.
 */

export interface TransportMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  tags?: Array<{ name: string; value: string }>;
}

export class TransportError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
    /** The provider's code (`validation_error`, `rate_limit_exceeded`, …) or `network`. */
    readonly code: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

/** Errors that will fail the same way on every retry. */
const PERMANENT = new Set([
  'validation_error',
  'missing_required_field',
  'invalid_parameter',
  'invalid_from_address',
  'invalid_attachment',
  'invalid_access',
  'restricted_api_key',
  'invalid_api_key',
  'missing_api_key',
  'security_error',
  'not_found',
  'method_not_allowed',
  'invalid_region',
  'invalid_idempotency_key',
  'invalid_idempotent_request',
]);

/** Spaces requests at least `1000 / perSecond` ms apart, in order. */
class RateLimiter {
  private next = 0;
  private readonly gapMs: number;

  constructor(perSecond: number) {
    this.gapMs = Math.ceil(1000 / perSecond);
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.gapMs;
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
  }

  /** After a 429, hold everyone back, not just the request that was refused. */
  pause(ms: number): void {
    this.next = Math.max(this.next, Date.now() + ms);
  }
}

export class ResendTransport {
  private readonly client: Resend;
  private readonly limiter: RateLimiter;

  constructor(apiKey: string, perSecond: number, client?: Resend) {
    this.client = client ?? new Resend(apiKey);
    this.limiter = new RateLimiter(perSecond);
  }

  async send(message: TransportMessage): Promise<{ messageId: string }> {
    await this.limiter.wait();
    let response: Awaited<ReturnType<Resend['emails']['send']>>;
    try {
      response = await this.client.emails.send(
        {
          from: message.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          replyTo: message.replyTo,
          headers: message.headers,
          tags: message.tags,
        },
        message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined,
      );
    } catch (error) {
      // The SDK reports API errors in `error`; a throw is the network or a bug.
      throw new TransportError(
        `Resend request failed: ${String((error as Error)?.message ?? error).slice(0, 300)}`,
        false,
        'network',
      );
    }

    if (response.error) {
      const { name, message: text, statusCode } = response.error;
      const retryAfter = Number(response.headers?.['retry-after']);
      const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
      if (name === 'rate_limit_exceeded') this.limiter.pause(retryAfterMs ?? 1000);
      // Quota errors are not the message's fault and clear on their own, so
      // they are retried — but not soon: the daily quota resets daily.
      const quota = name === 'daily_quota_exceeded' || name === 'monthly_quota_exceeded';
      const permanent =
        PERMANENT.has(name) || (statusCode !== null && statusCode >= 400 && statusCode < 500 && !quota && name !== 'rate_limit_exceeded' && name !== 'concurrent_idempotent_requests');
      throw new TransportError(
        `Resend refused the message (${name}${statusCode ? `, ${statusCode}` : ''}): ${String(text).slice(0, 300)}`,
        permanent,
        name,
        quota ? Math.max(retryAfterMs ?? 0, 60 * 60_000) : retryAfterMs,
      );
    }

    if (!response.data?.id) {
      throw new TransportError('Resend accepted the request but returned no message id', false, 'no_id');
    }
    return { messageId: response.data.id };
  }


  /**
   * Checks the key, and the sending domain if the key may read domains. A
   * sending-only key (Resend's recommended kind) answers `restricted_api_key`
   * here: it is valid, but the domain cannot be checked with it.
   */
  async checkConnection(fromEmail: string | null): Promise<{
    keyValid: boolean;
    restricted: boolean;
    domain: { name: string; status: string; verified: boolean } | null;
    error: string | null;
  }> {
    let response: Awaited<ReturnType<Resend['domains']['list']>>;
    try {
      response = await this.client.domains.list();
    } catch (error) {
      return {
        keyValid: false,
        restricted: false,
        domain: null,
        error: `Could not reach Resend: ${String((error as Error)?.message ?? error).slice(0, 200)}`,
      };
    }
    if (response.error) {
      const restricted = response.error.name === 'restricted_api_key';
      return {
        keyValid: restricted,
        restricted,
        domain: null,
        error: restricted ? null : `Resend refused the key (${response.error.name})`,
      };
    }
    const wanted = fromEmail?.split('@')[1]?.toLowerCase() ?? null;
    const match = wanted
      ? (response.data?.data ?? []).find(
          (domain) => wanted === domain.name.toLowerCase() || wanted.endsWith(`.${domain.name.toLowerCase()}`),
        )
      : undefined;
    return {
      keyValid: true,
      restricted: false,
      domain: match
        ? { name: match.name, status: match.status, verified: match.status === 'verified' }
        : null,
      error: null,
    };
  }
}

let verifier: Resend | undefined;

/**
 * Verifies a Resend webhook delivery with the SDK's own check (Standard
 * Webhooks: an HMAC over id, timestamp and the unmodified body, and a
 * timestamp window that refuses replays). Throws if the signature is wrong,
 * stale or missing. No request is made, so no API key is involved — the
 * client is constructed with a placeholder it never uses.
 */
export function verifyResendWebhook(
  rawBody: string,
  headers: { id: string; timestamp: string; signature: string },
  secret: string,
): unknown {
  verifier ??= new Resend('re_webhook_verification_only');
  return verifier.webhooks.verify({ payload: rawBody, headers, webhookSecret: secret });
}
