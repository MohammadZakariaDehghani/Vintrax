import { randomInt, randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { EmailSettingsService } from './email-settings.service';
import { ResendTransport, TransportError } from './resend.transport';
import {
  EMAIL_TEMPLATES,
  isTemplateKey,
  renderTemplate,
  type EmailTemplateKey,
  type EmailTemplateVars,
} from './templates/catalog';
import type { RenderedEmail } from './templates/layout';

/** A full message for `deliver`: HTML with a text fallback, a display name, headers. */
export interface RichMailMessage {
  to: string;
  toName?: string | null;
  /** Display name shown with the platform's sending address. */
  fromName?: string | null;
  replyTo?: string | null;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  /** Passed to the provider, so a retried call cannot send a second copy. */
  idempotencyKey?: string;
}

export interface MailReceipt {
  /** Which driver sent it: `resend`, `smtp`, or `log` when nothing left the server. */
  provider: string;
  /** The provider's id for the message, for matching delivery events. */
  messageId: string | null;
}

/**
 * A delivery that did not happen. `permanent` failures (the provider refused
 * the address or the message) are not worth retrying; anything else may
 * succeed later, after `retryAfterMs` if the provider said.
 */
export class MailDeliveryError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
    readonly code = 'error',
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

export interface SendOptions {
  /** One logical email, one send: a second call with the same key is dropped. */
  idempotencyKey?: string;
  userId?: string | null;
  dealerId?: string | null;
  related?: { type: string; id: string } | null;
  replyTo?: string | null;
  correlationId?: string;
  /** Wait for the outcome instead of sending in the background (the admin's test email). */
  wait?: boolean;
  /** Fewer attempts than MAIL_MAX_ATTEMPTS — 1 for a test, so the admin sees the real answer. */
  maxAttempts?: number;
}

export type AdminAlertSeverity = 'info' | 'warning' | 'critical';

export type ProviderEventStatus =
  | 'ACCEPTED'
  | 'DELAYED'
  | 'DELIVERED'
  | 'BOUNCED'
  | 'COMPLAINED'
  | 'FAILED';

/** How long a sender holds a claimed row before another may take it over. */
const LOCK_MS = 10 * 60_000;
/** An in-flight row this old whose sender vanished is given up on. */
const ABANDON_AFTER_MS = 2 * 24 * 60 * 60_000;
/** Waits longer than this are left to the sweep rather than an in-process timer. */
const LONGEST_INLINE_WAIT_MS = 5 * 60_000;
/** Statuses an event may move a message through, in lifecycle order. */
const RANK: Record<string, number> = {
  QUEUED: 0,
  SENDING: 1,
  ACCEPTED: 2,
  DELAYED: 3,
  DELIVERED: 4,
  FAILED: 5,
  BOUNCED: 5,
  COMPLAINED: 6,
};

/** Bounded exponential backoff with jitter: about 2s, 4s, 8s … capped at 15 minutes. */
export function mailBackoffMs(attempt: number, retryAfterMs?: number): number {
  const ceiling = Math.min(15 * 60_000, 2_000 * 2 ** Math.max(0, attempt - 1));
  const half = Math.max(1, Math.floor(ceiling / 2));
  return Math.max(half + randomInt(0, half), retryAfterMs ?? 0);
}

/** Lower-case and trim, so suppression and the log match one address one way. */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Transactional email — the one place Vintrax sends mail (D-068).
 *
 * Drivers: `log` writes messages to the server log (development and tests;
 * nothing leaves the machine), `resend` sends through the Resend API, `smtp`
 * through any SMTP server. Exactly one is active.
 *
 * Platform email goes through `sendTemplate`: a key from the template
 * catalogue, validated variables, a row in the EmailMessage log, then
 * delivery. Sending never throws — a failed email must not fail the request
 * behind it — and with a network driver it happens in the background, so a
 * request never waits on the provider (and a password-reset request takes
 * about the same time whether or not the address has an account).
 *
 * CRM email has its own outbox and calls `deliver`, which reports the outcome
 * and throws, so the CRM can retry and record bounces itself.
 */
@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly driver: 'log' | 'smtp' | 'resend';
  private readonly from: string;
  private readonly appUrl: string;
  private readonly replyTo?: string;
  private readonly adminTo: string[];
  private readonly notificationsEnabled: boolean;
  /** MAIL_MARKETING_ENABLED, read by the CRM dispatcher. */
  readonly marketingEnabled: boolean;
  private readonly maxAttempts: number;
  private readonly alertThreshold: number;
  private readonly resend?: ResendTransport;
  /**
   * Whether the log driver may print message bodies. Bodies carry one-time
   * verification and password-reset links, so in production — where logs are
   * shipped, retained and read by more people than the account holder — only
   * the envelope is written.
   */
  private readonly logBodies: boolean;
  private readonly inFlight = new Set<Promise<unknown>>();
  private sweeper?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Optional() private readonly prisma?: PrismaService,
    /** For tests: a stand-in Resend transport. */
    @Optional() resendTransport?: ResendTransport,
    /** Provider settings saved in the admin (D-069); without it, the environment decides. */
    @Optional() private readonly settings?: EmailSettingsService,
  ) {
    this.driver = this.config.get('MAIL_DRIVER', { infer: true });
    this.from = this.config.get('MAIL_FROM', { infer: true });
    this.appUrl = this.config.get('APP_URL', { infer: true }).replace(/\/$/, '');
    this.replyTo = this.config.get('MAIL_REPLY_TO', { infer: true }) ?? undefined;
    this.adminTo = this.config.get('MAIL_ADMIN_TO', { infer: true }) ?? [];
    this.notificationsEnabled =
      this.config.get('MAIL_NOTIFICATIONS_ENABLED', { infer: true }) ?? true;
    this.marketingEnabled = this.config.get('MAIL_MARKETING_ENABLED', { infer: true }) ?? true;
    this.maxAttempts = this.config.get('MAIL_MAX_ATTEMPTS', { infer: true }) ?? 5;
    this.alertThreshold = this.config.get('MAIL_ALERT_FAILURE_THRESHOLD', { infer: true }) ?? 10;
    this.logBodies = this.config.get('NODE_ENV', { infer: true }) !== 'production';
    if (this.driver === 'resend') {
      this.resend =
        resendTransport ??
        new ResendTransport(
          this.config.get('RESEND_API_KEY', { infer: true }) ?? '',
          this.config.get('RESEND_MAX_REQUESTS_PER_SECOND', { infer: true }) ?? 2,
        );
    }
    if (this.driver === 'log' && !this.logBodies) {
      this.logger.warn(
        'MAIL_DRIVER=log in production: no email will be delivered. Set MAIL_DRIVER=resend.',
      );
    }
  }

  onModuleInit(): void {
    this.logger.log(`Mail driver: ${this.driver}`);
    // The sweep retries messages that failed transiently and recovers ones
    // whose sender stopped part-way (a restart, a crash). Tests call `sweep()`
    // themselves, so timing never decides an assertion.
    if (this.prisma && this.config.get('NODE_ENV', { infer: true }) !== 'test') {
      this.sweeper = setInterval(() => {
        void this.sweep().catch((error: unknown) =>
          this.logger.error(`email.sweep_failed: ${errorSummary(error)}`),
        );
      }, 60_000);
      this.sweeper.unref();
    }
  }

  /** Lets in-flight sends finish, for a bounded time, before the process exits. */
  async onModuleDestroy(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    await this.flush(10_000);
  }

  /** Waits for background sends to settle. Tests use it; shutdown uses it. */
  async flush(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.inFlight.size && Date.now() < deadline) {
      await Promise.race([
        Promise.allSettled([...this.inFlight]),
        new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now())).unref()),
      ]);
    }
  }

  // ---------------------------------------------------------------------------
  // Platform email
  // ---------------------------------------------------------------------------

  /**
   * Renders a catalogue template and sends it. Never throws. Returns the log
   * row's id, or null when nothing was recorded (no database, or a duplicate).
   */
  async sendTemplate<K extends EmailTemplateKey>(
    key: K,
    to: string,
    vars: EmailTemplateVars<K>,
    options: SendOptions = {},
  ): Promise<string | null> {
    const template = EMAIL_TEMPLATES[key];
    const correlationId = options.correlationId ?? randomUUID();
    const recipient = normalizeAddress(to);

    let rendered: RenderedEmail;
    try {
      rendered = renderTemplate(key, vars, this.appUrl);
    } catch (error) {
      // A bad variable is a bug in the caller; logged without the values.
      this.logger.error(
        `email.render_failed template=${key} correlation=${correlationId}: ${errorSummary(error)}`,
      );
      return null;
    }

    const gated =
      (template.category === 'NOTIFICATION' || template.category === 'ADMIN') &&
      !this.notificationsEnabled;
    const suppressed =
      !gated && template.category !== 'SECURITY' && (await this.isSuppressed(recipient));

    if (!this.prisma) {
      if (gated || suppressed) return null;
      try {
        await this.deliverRendered(rendered, recipient, options.replyTo ?? undefined, undefined);
      } catch (error) {
        this.logger.error(`email.failed template=${key}: ${errorSummary(error)}`);
      }
      return null;
    }

    let row: { id: string };
    try {
      row = await this.prisma.emailMessage.create({
        data: {
          category: template.category,
          templateKey: key,
          toEmail: recipient,
          subject: rendered.subject.slice(0, 250),
          status: gated ? 'SKIPPED' : suppressed ? 'SUPPRESSED' : 'QUEUED',
          lastError: gated
            ? 'MAIL_NOTIFICATIONS_ENABLED=false'
            : suppressed
              ? 'The address bounced or complained earlier'
              : null,
          idempotencyKey: options.idempotencyKey ?? `${key}:${randomUUID()}`,
          correlationId,
          userId: options.userId ?? null,
          dealerId: options.dealerId ?? null,
          relatedType: options.related?.type ?? null,
          relatedId: options.related?.id ?? null,
          // Never for a template carrying a secret link: those variables are
          // not written anywhere, so the log cannot be used to sign in.
          payload: template.secret
            ? Prisma.DbNull
            : ({ vars, replyTo: options.replyTo ?? null } as Prisma.InputJsonValue),
          lockedUntil: gated || suppressed ? null : new Date(Date.now() + LOCK_MS),
        },
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.debug(`email.duplicate template=${key} correlation=${correlationId}`);
        return null;
      }
      this.logger.error(
        `email.record_failed template=${key} correlation=${correlationId}: ${errorSummary(error)}`,
      );
      return null;
    }

    if (gated || suppressed) {
      this.logger.log(`email.${gated ? 'skipped' : 'suppressed'} id=${row.id} template=${key}`);
      return row.id;
    }

    const run = this.attemptLoop(
      row.id,
      rendered,
      recipient,
      options.replyTo ?? undefined,
      correlationId,
      options.maxAttempts,
    );
    if (options.wait || (await this.activeConfig()).driver === 'log') {
      // Nothing leaves the machine, so there is nothing to wait for — and
      // development wants the link in the log by the time the request returns.
      await run.catch((error: unknown) =>
        this.logger.error(`email.send_crashed id=${row.id}: ${errorSummary(error)}`),
      );
    } else {
      this.track(run);
    }
    return row.id;
  }

  /** Sends one operational alert to MAIL_ADMIN_TO, at most once an hour per alert key. */
  async alertAdmins(alert: {
    key: string;
    severity: AdminAlertSeverity;
    title: string;
    summary: string;
    link?: string | null;
  }): Promise<void> {
    if (!this.adminTo.length) return;
    const hour = new Date().toISOString().slice(0, 13);
    for (const to of this.adminTo) {
      await this.sendTemplate(
        'admin.alert',
        to,
        {
          severity: alert.severity,
          title: alert.title,
          summary: alert.summary,
          link: alert.link ?? null,
          occurredAt: new Date().toISOString(),
        },
        // The hour in the key is the duplicate suppression: the same alert in
        // the same hour hits the unique index and is dropped.
        { idempotencyKey: `admin.alert:${alert.key}:${hour}:${to}` },
      );
    }
  }

  /**
   * The admin's test email (D-069): sent once, now, through the provider in
   * force, and reported back as it happened — accepted with an id, or the
   * provider's refusal.
   */
  async sendTestEmail(
    to: string,
    firstName: string,
    userId: string,
  ): Promise<{ ok: boolean; providerMessageId: string | null; message: string }> {
    const active = await this.activeConfig();
    const id = await this.sendTemplate(
      'settings.test-email',
      to,
      {
        firstName,
        provider: active.driver,
        source: active.source,
        sentAt: new Date().toISOString(),
      },
      { userId, wait: true, maxAttempts: 1 },
    );
    if (!id || !this.prisma) {
      return { ok: false, providerMessageId: null, message: 'The test email could not be recorded.' };
    }
    const row = await this.prisma.emailMessage.findUniqueOrThrow({ where: { id } });
    if (row.status === 'ACCEPTED') {
      return {
        ok: true,
        providerMessageId: row.providerMessageId,
        message:
          active.driver === 'log'
            ? 'Nothing was sent: the active driver is log, which writes email to the server log.'
            : `${active.driver === 'resend' ? 'Resend' : 'The SMTP server'} accepted it. Check the inbox — acceptance is not delivery.`,
      };
    }
    return {
      ok: false,
      providerMessageId: null,
      message: `Not sent (${row.lastErrorCode ?? row.status}): ${row.lastError ?? 'see Admin → Emails'}`,
    };
  }

  // --- Named sends, for readability at the call sites -------------------------

  async sendEmailVerification(
    to: string,
    token: string,
    firstName: string,
    userId?: string,
  ): Promise<void> {
    await this.sendTemplate('auth.verify-email', to, { firstName, token }, { userId });
  }

  async sendPasswordReset(
    to: string,
    token: string,
    firstName: string,
    userId?: string,
  ): Promise<void> {
    await this.sendTemplate('auth.password-reset', to, { firstName, token }, { userId });
  }

  /**
   * Tells a seller a finance application arrived. Only who applied and how to
   * reach them: the date of birth, income and employment stay in the portal,
   * behind the seller's sign-in, rather than in an inbox.
   */
  async sendFinanceApplicationNotice(
    to: string,
    details: EmailTemplateVars<'finance.application'>,
    options: SendOptions = {},
  ): Promise<void> {
    await this.sendTemplate('finance.application', to, details, options);
  }

  async sendOutbidNotice(
    to: string,
    firstName: string,
    vehicleTitle: string,
    auctionId: string,
    currentBidCad: number,
  ): Promise<void> {
    await this.sendTemplate('auction.outbid', to, {
      firstName,
      vehicleTitle,
      auctionId,
      currentBidCad,
    });
  }

  // ---------------------------------------------------------------------------
  // Delivery
  // ---------------------------------------------------------------------------

  /**
   * Tries one logged message until it is accepted, refused, or out of
   * attempts, waiting between attempts in-process. If the process stops, the
   * sweep takes over from the row — or, for a message carrying a secret link,
   * records that it was interrupted.
   */
  private async attemptLoop(
    id: string,
    rendered: RenderedEmail,
    to: string,
    replyTo: string | undefined,
    correlationId: string,
    maxAttempts = this.maxAttempts,
  ): Promise<void> {
    if (!this.prisma) return;
    for (;;) {
      const row = await this.prisma.emailMessage.update({
        where: { id },
        data: {
          status: 'SENDING',
          attempts: { increment: 1 },
          lockedUntil: new Date(Date.now() + LOCK_MS),
        },
        select: { attempts: true, idempotencyKey: true },
      });
      try {
        const receipt = await this.deliverRendered(rendered, to, replyTo, row.idempotencyKey);
        await this.prisma.emailMessage.update({
          where: { id },
          data: {
            status: 'ACCEPTED',
            provider: receipt.provider,
            providerMessageId: receipt.messageId,
            sentAt: new Date(),
            lockedUntil: null,
            lastError: null,
            lastErrorCode: null,
          },
        });
        this.logger.log(
          `email.accepted id=${id} provider=${receipt.provider} attempt=${row.attempts} correlation=${correlationId}`,
        );
        return;
      } catch (error) {
        const failure = asDeliveryError(error);
        const giveUp = failure.permanent || row.attempts >= maxAttempts;
        const wait = mailBackoffMs(row.attempts, failure.retryAfterMs);
        const inline = !giveUp && wait <= LONGEST_INLINE_WAIT_MS;
        await this.prisma.emailMessage.update({
          where: { id },
          data: {
            status: giveUp ? 'FAILED' : 'QUEUED',
            failedAt: giveUp ? new Date() : undefined,
            lastErrorCode: failure.code.slice(0, 64),
            lastError: failure.message.slice(0, 500),
            nextAttemptAt: new Date(Date.now() + wait),
            // Held while this process waits to retry; released when the wait
            // is long enough to leave to the sweep.
            lockedUntil: inline ? new Date(Date.now() + wait + LOCK_MS) : null,
          },
        });
        this.logger.warn(
          `email.${giveUp ? 'failed' : 'retry'} id=${id} attempt=${row.attempts} code=${failure.code} permanent=${failure.permanent} correlation=${correlationId}`,
        );
        if (giveUp) {
          await this.checkFailureThreshold();
          return;
        }
        if (!inline) return;
        await new Promise((resolve) => setTimeout(resolve, wait).unref());
      }
    }
  }

  /** One send through the active driver. Throws MailDeliveryError. */
  private async deliverRendered(
    rendered: RenderedEmail,
    to: string,
    replyTo: string | undefined,
    idempotencyKey: string | undefined,
  ): Promise<MailReceipt> {
    const active = await this.activeConfig();
    return this.deliver({
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      replyTo: replyTo ?? active.replyTo ?? null,
      idempotencyKey,
    });
  }

  /**
   * The provider configuration in force for this send: the admin's stored
   * settings when they are switched on, otherwise the environment.
   */
  private async activeConfig(): Promise<{
    source: 'database' | 'environment';
    driver: 'log' | 'smtp' | 'resend';
    from: string;
    replyTo?: string;
    apiKey?: string;
  }> {
    if (this.settings) return this.settings.active();
    return { source: 'environment', driver: this.driver, from: this.from, replyTo: this.replyTo };
  }

  /**
   * Sends one message and reports what happened, for callers that track
   * delivery themselves (the CRM outbox). A failure throws a
   * `MailDeliveryError`, so the caller can retry or record a bounce.
   */
  async deliver(message: RichMailMessage): Promise<MailReceipt> {
    const active = await this.activeConfig();
    const fromAddress = /<([^>]+)>/.exec(active.from)?.[1] ?? active.from;
    const from = message.fromName
      ? `"${message.fromName.replace(/["\\\r\n]/g, '')}" <${fromAddress}>`
      : active.from;
    const to = message.toName
      ? `"${message.toName.replace(/["\\\r\n]/g, '')}" <${message.to}>`
      : message.to;

    if (active.driver === 'log') {
      if (this.logBodies) {
        this.logger.log(
          `\n--- email (${from} -> ${to}) ---\n` +
            (message.replyTo ? `Reply-To: ${message.replyTo}\n` : '') +
            `Subject: ${message.subject}\n\n${message.text}\n--- end ---`,
        );
      } else {
        this.logger.warn(`Email not sent (MAIL_DRIVER=log): "${message.subject}"`);
      }
      return { provider: 'log', messageId: `log-${randomUUID()}` };
    }

    if (active.driver === 'resend') {
      const transport =
        active.source === 'database' && active.apiKey && this.settings
          ? this.settings.transportFor(active.apiKey)
          : this.resend;
      if (!transport) {
        throw new MailDeliveryError(
          'Resend is selected but no API key is configured',
          true,
          'missing_api_key',
        );
      }
      try {
        const { messageId } = await transport.send({
          from,
          to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          replyTo: message.replyTo ?? undefined,
          headers: message.headers,
          idempotencyKey: message.idempotencyKey,
        });
        return { provider: 'resend', messageId };
      } catch (error) {
        throw asDeliveryError(error);
      }
    }

    try {
      const transport = await this.transport();
      const info = (await transport.sendMail({
        from,
        to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo ?? undefined,
        headers: message.headers,
      })) as { messageId?: string; rejected?: unknown[] };
      if (Array.isArray(info.rejected) && info.rejected.length > 0) {
        throw new MailDeliveryError('The mail server rejected the recipient', true, 'rejected');
      }
      return { provider: 'smtp', messageId: info.messageId ?? null };
    } catch (error) {
      if (error instanceof MailDeliveryError) throw error;
      const code = (error as { responseCode?: number }).responseCode;
      // 5xx is the server's final answer about this address; 4xx and network
      // errors are worth another try.
      throw new MailDeliveryError(
        String((error as Error).message ?? error).slice(0, 500),
        typeof code === 'number' && code >= 500 && code < 600,
        typeof code === 'number' ? `smtp_${code}` : 'network',
      );
    }
  }

  private transporter?: Promise<import('nodemailer').Transporter>;

  /** One pooled SMTP connection for the process, rather than a handshake per email. */
  private transport(): Promise<import('nodemailer').Transporter> {
    this.transporter ??= import('nodemailer')
      // nodemailer is loaded lazily so the other drivers carry no SMTP dependency.
      .then(({ createTransport }) =>
        createTransport({
          pool: true,
          host: this.config.get('SMTP_HOST', { infer: true }),
          port: this.config.get('SMTP_PORT', { infer: true }),
          secure: this.config.get('SMTP_PORT', { infer: true }) === 465,
          auth: {
            user: this.config.get('SMTP_USER', { infer: true }),
            pass: this.config.get('SMTP_PASSWORD', { infer: true }),
          },
        }),
      )
      .catch((error: unknown) => {
        this.transporter = undefined;
        throw error;
      });
    return this.transporter;
  }

  // ---------------------------------------------------------------------------
  // The outbox sweep
  // ---------------------------------------------------------------------------

  /**
   * Retries due messages and recovers ones whose sender stopped. Rows are
   * claimed with FOR UPDATE SKIP LOCKED, so several API processes can sweep at
   * once without two taking the same message. Returns how many were claimed;
   * the sends themselves run in the background (`flush` waits for them).
   */
  async sweep(now = new Date(), limit = 25): Promise<number> {
    if (!this.prisma) return 0;
    const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "EmailMessage" SET status = 'SENDING', "lockedUntil" = ${new Date(now.getTime() + LOCK_MS)}
      WHERE id IN (
        SELECT id FROM "EmailMessage"
        WHERE status IN ('QUEUED', 'SENDING')
          AND ("lockedUntil" IS NULL OR "lockedUntil" < ${now})
          AND "nextAttemptAt" <= ${now}
        ORDER BY "nextAttemptAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;

    for (const { id } of claimed) {
      const row = await this.prisma.emailMessage.findUniqueOrThrow({ where: { id } });
      const stored = row.payload as { vars?: unknown; replyTo?: string | null } | null;
      const abandoned = now.getTime() - row.createdAt.getTime() > ABANDON_AFTER_MS;
      if (
        !stored?.vars ||
        !isTemplateKey(row.templateKey) ||
        abandoned ||
        row.attempts >= this.maxAttempts
      ) {
        await this.prisma.emailMessage.update({
          where: { id },
          data: {
            status: 'FAILED',
            failedAt: now,
            lockedUntil: null,
            lastErrorCode: stored?.vars ? (row.lastErrorCode ?? 'gave_up') : 'interrupted',
            lastError: stored?.vars
              ? (row.lastError ?? 'Gave up: out of attempts, or too old to send')
              : 'The sender stopped before this was accepted. It carried a single-use link, which is never stored, so it cannot be re-sent — the person can ask for a new one.',
          },
        });
        continue;
      }
      let rendered: RenderedEmail;
      try {
        rendered = renderTemplate(row.templateKey, stored.vars as never, this.appUrl);
      } catch (error) {
        await this.prisma.emailMessage.update({
          where: { id },
          data: {
            status: 'FAILED',
            failedAt: now,
            lockedUntil: null,
            lastErrorCode: 'render',
            lastError: errorSummary(error),
          },
        });
        continue;
      }
      this.track(
        this.attemptLoop(
          id,
          rendered,
          row.toEmail,
          stored.replyTo ?? undefined,
          row.correlationId ?? id,
        ),
      );
    }
    return claimed.length;
  }

  /** One alert when failures in the last hour reach MAIL_ALERT_FAILURE_THRESHOLD. */
  private async checkFailureThreshold(): Promise<void> {
    if (!this.prisma || !this.adminTo.length) return;
    const since = new Date(Date.now() - 60 * 60_000);
    const failed = await this.prisma.emailMessage.count({
      where: {
        status: { in: ['FAILED', 'BOUNCED'] },
        updatedAt: { gte: since },
        category: { not: 'ADMIN' },
      },
    });
    if (failed < this.alertThreshold) return;
    await this.alertAdmins({
      key: 'email-failures',
      severity: 'warning',
      title: 'Email delivery failures',
      summary: `${failed} platform emails failed or bounced in the last hour (threshold ${this.alertThreshold}). Admin → Emails lists them with the provider's reason.`,
      link: '/admin/emails',
    });
  }

  // ---------------------------------------------------------------------------
  // Delivery events, suppression, administration
  // ---------------------------------------------------------------------------

  /**
   * Applies a provider delivery event to a platform message. A later event
   * never undoes a further one: a `delivered` that arrives after a
   * `complained` records its timestamp, not its status. Returns whether a
   * platform message matched.
   */
  async applyProviderEvent(event: {
    providerMessageId: string;
    status: ProviderEventStatus;
    detail?: string | null;
    occurredAt: Date;
  }): Promise<boolean> {
    if (!this.prisma) return false;
    const row = await this.prisma.emailMessage.findFirst({
      where: { providerMessageId: event.providerMessageId },
      select: { id: true, status: true },
    });
    if (!row) return false;
    const advance = (RANK[event.status] ?? 0) > (RANK[row.status] ?? 0);
    await this.prisma.emailMessage.update({
      where: { id: row.id },
      data: {
        lastEventAt: event.occurredAt,
        ...(event.status === 'DELIVERED' ? { deliveredAt: event.occurredAt } : {}),
        ...(event.status === 'BOUNCED' ? { bouncedAt: event.occurredAt } : {}),
        ...(event.status === 'COMPLAINED' ? { complainedAt: event.occurredAt } : {}),
        ...(event.status === 'FAILED' ? { failedAt: event.occurredAt } : {}),
        ...(advance ? { status: event.status } : {}),
        ...(advance && event.detail ? { lastError: event.detail.slice(0, 500) } : {}),
      },
    });
    return true;
  }

  /**
   * Stops sending to an address that hard-bounced or complained, platform-wide.
   * The CRM reads the same list (CrmSuppression with no dealer), so one bounce
   * protects both. Security email is still attempted — the provider decides.
   */
  async suppress(
    address: string,
    reason: 'HARD_BOUNCE' | 'COMPLAINT',
    source: string,
  ): Promise<void> {
    if (!this.prisma) return;
    const email = normalizeAddress(address);
    const existing = await this.prisma.crmSuppression.findFirst({
      where: { dealerId: null, email, reason },
      select: { id: true },
    });
    if (existing) return;
    await this.prisma.crmSuppression.create({ data: { dealerId: null, email, reason, source } });
  }

  private async isSuppressed(address: string): Promise<boolean> {
    if (!this.prisma) return false;
    const hit = await this.prisma.crmSuppression.findFirst({
      where: {
        dealerId: null,
        email: address,
        reason: { in: ['HARD_BOUNCE', 'COMPLAINT', 'INVALID'] },
      },
      select: { id: true },
    });
    return !!hit;
  }

  /**
   * An administrator's retry of a failed message: the same template, the same
   * recipient, the same variables — nothing about it can be changed. Messages
   * that carried a secret link have no stored variables and cannot be retried.
   */
  async retry(id: string): Promise<'queued' | 'not_found' | 'not_retryable'> {
    if (!this.prisma) return 'not_found';
    const row = await this.prisma.emailMessage.findUnique({
      where: { id },
      select: { status: true, payload: true, templateKey: true, toEmail: true },
    });
    if (!row) return 'not_found';
    if (row.status !== 'FAILED' || row.payload === null || !isTemplateKey(row.templateKey)) {
      return 'not_retryable';
    }
    if (await this.isSuppressed(row.toEmail)) return 'not_retryable';
    const updated = await this.prisma.emailMessage.updateMany({
      where: { id, status: 'FAILED' },
      data: {
        status: 'QUEUED',
        attempts: 0,
        nextAttemptAt: new Date(),
        lockedUntil: null,
        failedAt: null,
      },
    });
    return updated.count === 1 ? 'queued' : 'not_retryable';
  }

  /** Counts by status and category since a moment, for the admin dashboard. */
  async stats(since: Date) {
    const empty = {
      since: since.toISOString(),
      driver: (await this.activeConfig()).driver as string,
      total: 0,
      retried: 0,
      byStatus: {} as Record<string, number>,
      byCategory: {} as Record<string, number>,
    };
    if (!this.prisma) return empty;
    const rows = await this.prisma.emailMessage.groupBy({
      by: ['status', 'category'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    for (const row of rows) {
      empty.byStatus[row.status] = (empty.byStatus[row.status] ?? 0) + row._count._all;
      empty.byCategory[row.category] = (empty.byCategory[row.category] ?? 0) + row._count._all;
      empty.total += row._count._all;
    }
    empty.retried = await this.prisma.emailMessage.count({
      where: { createdAt: { gte: since }, attempts: { gt: 1 } },
    });
    return empty;
  }

  private track(run: Promise<unknown>): void {
    const tracked: Promise<unknown> = run
      .catch((error: unknown) => this.logger.error(`email.send_crashed: ${errorSummary(error)}`))
      .finally(() => this.inFlight.delete(tracked));
    this.inFlight.add(tracked);
  }
}

function asDeliveryError(error: unknown): MailDeliveryError {
  if (error instanceof MailDeliveryError) return error;
  if (error instanceof TransportError) {
    return new MailDeliveryError(error.message, error.permanent, error.code, error.retryAfterMs);
  }
  return new MailDeliveryError(errorSummary(error), false, 'error');
}

/** An error's message, bounded; never its stack, never the values that caused it. */
function errorSummary(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues: Array<{ path: unknown[]; message: string }> }).issues;
    return `invalid variables: ${issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`.slice(
      0,
      500,
    );
  }
  return String((error as Error)?.message ?? error).slice(0, 500);
}
