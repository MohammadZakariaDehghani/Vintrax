import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  EmailConnectionTestInput,
  EmailConnectionTestResult,
  EmailSettingsUpdateInput,
  EmailSettingsView,
} from '@vintrax/shared';
import type { Env } from '../../config/env';
import { SecretBox } from '../crypto/secret-box';
import { PrismaService } from '../prisma/prisma.service';
import { ResendTransport } from './resend.transport';

/** Lets tests substitute the Resend client a stored key is used with. */
export const RESEND_TRANSPORT_FACTORY = Symbol('RESEND_TRANSPORT_FACTORY');
export type ResendTransportFactory = (apiKey: string) => ResendTransport;

/** Binds the ciphertext to its purpose: it does not open under any other label. */
const AAD = 'email-settings:resend:api-key';
const CACHE_MS = 30_000;
const PLACEHOLDER_DOMAIN = /@[^>]*\.(local|test|example|invalid)$/i;

/** The provider configuration in force. `apiKey` never leaves the server. */
export interface ActiveMailConfig {
  source: 'database' | 'environment';
  driver: 'log' | 'smtp' | 'resend';
  from: string;
  replyTo?: string;
  apiKey?: string;
}

/**
 * Email provider settings managed in Admin → Settings → Email (D-069).
 *
 * One row. The API key is stored only as AES-256-GCM ciphertext under
 * SETTINGS_ENCRYPTION_KEY (server environment only); the view sent to the
 * browser carries whether a key is set and its last four characters, never the
 * key. While the row is not `enabled` — or cannot be decrypted — the
 * environment's MAIL_* settings stay in force, so nothing changes for a
 * deployment until a super admin switches the stored settings on.
 *
 * Tests never send through stored settings unless a transport factory is
 * injected (and that factory is a stand-in): NODE_ENV=test keeps the log
 * driver, as the environment rules already require.
 */
@Injectable()
export class EmailSettingsService {
  private readonly logger = new Logger(EmailSettingsService.name);
  private readonly box: SecretBox | null;
  private cache?: { value: ActiveMailConfig; at: number };
  private readonly transports = new Map<string, ResendTransport>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Optional() @Inject(RESEND_TRANSPORT_FACTORY) private readonly factory?: ResendTransportFactory,
  ) {
    const key = this.config.get('SETTINGS_ENCRYPTION_KEY', { infer: true });
    this.box = key ? new SecretBox(key) : null;
  }

  /** The environment's configuration — what applies while stored settings are off. */
  environmentConfig(): ActiveMailConfig {
    const driver = this.config.get('MAIL_DRIVER', { infer: true });
    return {
      source: 'environment',
      driver,
      from: this.config.get('MAIL_FROM', { infer: true }),
      replyTo: this.config.get('MAIL_REPLY_TO', { infer: true }) ?? undefined,
      apiKey:
        driver === 'resend'
          ? (this.config.get('RESEND_API_KEY', { infer: true }) ?? undefined)
          : undefined,
    };
  }

  /** What sends right now: stored settings when enabled and readable, else the environment. */
  async active(): Promise<ActiveMailConfig> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    let value = this.environmentConfig();
    const testRun = this.config.get('NODE_ENV', { infer: true }) === 'test' && !this.factory;
    if (!testRun) {
      try {
        const row = await this.prisma.emailProviderSettings.findUnique({ where: { id: 1 } });
        if (row?.enabled && row.fromEmail) {
          const apiKey = this.decrypt(row);
          if (apiKey) {
            value = {
              source: 'database',
              driver: 'resend',
              from: `${row.fromName} <${row.fromEmail}>`,
              replyTo: row.replyTo ?? undefined,
              apiKey,
            };
          } else {
            this.logger.error(
              'email.settings_unreadable: stored email settings are enabled but the API key cannot be decrypted (SETTINGS_ENCRYPTION_KEY missing or changed); the environment settings are used',
            );
          }
        }
      } catch (error) {
        this.logger.error(
          `email.settings_read_failed: ${String((error as Error)?.message ?? error).slice(0, 200)}`,
        );
      }
    }
    this.cache = { value, at: Date.now() };
    return value;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  /** One Resend client per key, created on first use. */
  transportFor(apiKey: string): ResendTransport {
    const id = createHash('sha256').update(apiKey).digest('hex');
    let transport = this.transports.get(id);
    if (!transport) {
      transport =
        this.factory?.(apiKey) ??
        new ResendTransport(
          apiKey,
          this.config.get('RESEND_MAX_REQUESTS_PER_SECOND', { infer: true }) ?? 2,
        );
      this.transports.clear(); // a replaced key's client is not kept around
      this.transports.set(id, transport);
    }
    return transport;
  }

  async view(): Promise<EmailSettingsView> {
    const row = await this.prisma.emailProviderSettings.findUnique({ where: { id: 1 } });
    const active = await this.active();
    return {
      provider: 'resend',
      enabled: row?.enabled ?? false,
      fromName: row?.fromName ?? 'Vintrax',
      fromEmail: row?.fromEmail ?? null,
      replyTo: row?.replyTo ?? null,
      apiKey: {
        set: !!row?.apiKeyCiphertext,
        last4: row?.apiKeyLast4 ?? null,
        updatedAt: row?.apiKeyUpdatedAt?.toISOString() ?? null,
        decryptable: !!row?.apiKeyCiphertext && this.decrypt(row) !== null,
      },
      encryptionConfigured: !!this.box,
      active: { source: active.source, driver: active.driver, from: active.from },
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  /**
   * Saves the settings. A new key is encrypted before it reaches the database;
   * leaving it out keeps the stored one. Returns the names of what changed, for
   * the audit log — never a value of the key.
   */
  async update(input: EmailSettingsUpdateInput, actorId: string): Promise<string[]> {
    const row = await this.prisma.emailProviderSettings.findUnique({ where: { id: 1 } });
    if (input.apiKey && !this.box) {
      throw new BadRequestException(
        'This server cannot store secrets yet: SETTINGS_ENCRYPTION_KEY is not set. Ask whoever runs the server to add it.',
      );
    }
    const sealed = input.apiKey ? this.box!.seal(input.apiKey, AAD) : null;
    const hasKeyAfter = input.clearApiKey ? false : !!sealed || !!row?.apiKeyCiphertext;
    const keyReadable =
      !!sealed || (!input.clearApiKey && !!row?.apiKeyCiphertext && this.decrypt(row) !== null);
    // Removing the key always switches the stored settings off, whatever the
    // form said — there is nothing left to send with.
    const enabled = input.clearApiKey ? false : input.enabled;

    if (enabled) {
      if (!hasKeyAfter || !keyReadable) {
        throw new BadRequestException({
          message: 'Add a working API key before turning these settings on',
          details: { apiKey: ['An API key is required to send through Resend'] },
        });
      }
      if (PLACEHOLDER_DOMAIN.test(input.fromEmail)) {
        throw new BadRequestException({
          message: 'Use an address on your verified sending domain',
          details: { fromEmail: ['This is a placeholder domain Resend will not send from'] },
        });
      }
    }

    const changes: string[] = [];
    if (!row || row.enabled !== enabled) changes.push(enabled ? 'enabled' : 'disabled');
    if (!row || row.fromName !== input.fromName) changes.push('fromName');
    if (!row || row.fromEmail !== input.fromEmail) changes.push('fromEmail');
    if (!row || (row.replyTo ?? null) !== (input.replyTo ?? null)) changes.push('replyTo');
    if (sealed) changes.push(row?.apiKeyCiphertext ? 'apiKey.replaced' : 'apiKey.added');
    if (input.clearApiKey && row?.apiKeyCiphertext) changes.push('apiKey.removed');

    const keyFields = sealed
      ? {
          apiKeyCiphertext: sealed.ciphertext,
          apiKeyIv: sealed.iv,
          apiKeyTag: sealed.tag,
          apiKeyKeyId: sealed.keyId,
          apiKeyLast4: input.apiKey!.slice(-4),
          apiKeyUpdatedAt: new Date(),
        }
      : input.clearApiKey
        ? {
            apiKeyCiphertext: null,
            apiKeyIv: null,
            apiKeyTag: null,
            apiKeyKeyId: null,
            apiKeyLast4: null,
            apiKeyUpdatedAt: new Date(),
          }
        : {};
    const data = {
      provider: input.provider,
      enabled,
      fromName: input.fromName,
      fromEmail: input.fromEmail,
      replyTo: input.replyTo ?? null,
      updatedById: actorId,
      ...keyFields,
    };
    await this.prisma.emailProviderSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });
    this.invalidate();
    return changes;
  }

  /**
   * Checks a key against Resend without sending: the key typed into the form,
   * or the stored one. Never stores anything.
   */
  async testConnection(input: EmailConnectionTestInput): Promise<EmailConnectionTestResult> {
    let apiKey = input.apiKey;
    let fromEmail = input.fromEmail ?? null;
    if (!apiKey) {
      const row = await this.prisma.emailProviderSettings.findUnique({ where: { id: 1 } });
      fromEmail ??= row?.fromEmail ?? null;
      apiKey = row ? (this.decrypt(row) ?? undefined) : undefined;
      if (!apiKey) {
        return {
          ok: false,
          keyValid: false,
          restricted: false,
          domain: null,
          message: row?.apiKeyCiphertext
            ? 'The stored key cannot be read on this server (SETTINGS_ENCRYPTION_KEY missing or changed). Enter the key again.'
            : 'No API key is stored. Enter one to test it.',
        };
      }
    }
    const result = await this.transportFor(apiKey).checkConnection(fromEmail);
    const ok = result.keyValid && (result.restricted || !fromEmail || !!result.domain?.verified);
    let message: string;
    if (!result.keyValid) message = result.error ?? 'Resend did not accept the key.';
    else if (result.restricted)
      message =
        'The key works. It is a sending-only key, so the sending domain was not checked — send a test email to confirm.';
    else if (!fromEmail) message = 'The key works.';
    else if (!result.domain)
      message = `The key works, but ${fromEmail.split('@')[1]} is not a domain in this Resend account.`;
    else if (!result.domain.verified)
      message = `The key works, but ${result.domain.name} is ${result.domain.status} in Resend — finish its DNS verification first.`;
    else message = `The key works and ${result.domain.name} is verified.`;
    return {
      ok,
      keyValid: result.keyValid,
      restricted: result.restricted,
      domain: result.domain,
      message,
    };
  }

  /** The stored key, or null when there is none or it cannot be opened here. */
  private decrypt(row: {
    apiKeyCiphertext: string | null;
    apiKeyIv: string | null;
    apiKeyTag: string | null;
    apiKeyKeyId: string | null;
  }): string | null {
    if (!this.box || !row.apiKeyCiphertext || !row.apiKeyIv || !row.apiKeyTag) return null;
    if (row.apiKeyKeyId && row.apiKeyKeyId !== this.box.keyId) return null;
    try {
      return this.box.open(
        { ciphertext: row.apiKeyCiphertext, iv: row.apiKeyIv, tag: row.apiKeyTag },
        AAD,
      );
    } catch {
      return null;
    }
  }
}
