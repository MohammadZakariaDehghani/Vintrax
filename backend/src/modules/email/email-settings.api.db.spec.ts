import { randomBytes, randomUUID } from 'node:crypto';
import {
  Global,
  Injectable,
  Logger,
  Module,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { UserRole } from '@vintrax/shared';
import request from 'supertest';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { IS_PUBLIC_KEY } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import {
  EmailSettingsService,
  RESEND_TRANSPORT_FACTORY,
} from '../../common/mail/email-settings.service';
import { MailService } from '../../common/mail/mail.service';
import type { ResendTransport, TransportMessage } from '../../common/mail/resend.transport';
import { PrismaService } from '../../common/prisma/prisma.service';
import { closeTestPrisma, describeDb, testPrisma } from '../accounting/testing/harness';
import { EmailSettingsController } from './email-settings.controller';

/**
 * Admin → Settings → Email over HTTP and a real database (D-069): the real
 * controller, permission guard, rate limiter, encryption and mail service.
 * Resend is a stand-in — nothing is sent — and every log line written during
 * the run is captured, to prove the key never appears in one.
 */

jest.setTimeout(30_000);

const ENCRYPTION_KEY = randomBytes(32).toString('base64');
const KEY_ONE = `re_${randomBytes(18).toString('hex')}`;
const KEY_TWO = `re_${randomBytes(18).toString('hex')}`;

/** Every Resend client the settings create, by the key it was created with. */
const transports = new Map<
  string,
  { send: jest.Mock; checkConnection: jest.Mock; sent: TransportMessage[] }
>();
const connection = {
  next: {
    keyValid: true,
    restricted: false,
    domain: { name: 'vintrax.ca', status: 'verified', verified: true },
    error: null,
  } as unknown,
};
function factory(apiKey: string): ResendTransport {
  const sent: TransportMessage[] = [];
  const stub = {
    sent,
    send: jest.fn(async (message: TransportMessage) => {
      sent.push(message);
      return { messageId: `em_${randomUUID()}` };
    }),
    checkConnection: jest.fn(async () => connection.next),
  };
  transports.set(apiKey, stub);
  return stub as unknown as ResendTransport;
}

@Injectable()
class TestAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: AuthUser }>();
    const id = req.headers['x-test-user'];
    if (!id) return !!Reflect.getMetadata(IS_PUBLIC_KEY, context.getHandler());
    const user = await testPrisma().user.findUniqueOrThrow({ where: { id } });
    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role as UserRole,
      status: user.status,
      emailVerified: user.emailVerified,
      dealerId: null,
    };
    return true;
  }
}

const baseConfig = {
  NODE_ENV: 'development',
  MAIL_DRIVER: 'log',
  MAIL_FROM: 'Vintrax <no-reply@vintrax.local>',
  APP_URL: 'https://vintrax.test',
  MAIL_ADMIN_TO: [],
  MAIL_NOTIFICATIONS_ENABLED: true,
  MAIL_MARKETING_ENABLED: true,
  MAIL_MAX_ATTEMPTS: 3,
  MAIL_ALERT_FAILURE_THRESHOLD: 1000,
  SETTINGS_ENCRYPTION_KEY: ENCRYPTION_KEY,
};

@Global()
@Module({
  providers: [
    { provide: PrismaService, useFactory: () => testPrisma() },
    { provide: RESEND_TRANSPORT_FACTORY, useValue: factory },
    EmailSettingsService,
    {
      provide: MailService,
      inject: [ConfigService, PrismaService, EmailSettingsService],
      useFactory: (config: ConfigService, prisma: PrismaService, settings: EmailSettingsService) =>
        new MailService(config as never, prisma, undefined, settings),
    },
    AuditService,
  ],
  exports: [PrismaService, EmailSettingsService, MailService, AuditService],
})
class TestPlatformModule {}

describeDb('Admin → Settings → Email', () => {
  const prisma = testPrisma();
  let app: INestApplication;
  let mail: MailService;
  const run = randomUUID().slice(0, 8);
  const users = { superAdmin: '', admin: '', unverified: '' };
  const logs: string[] = [];
  let ip = 0;
  /** A fresh client address per call, so the rate limiter only bites where a test means it to. */
  const call = (
    method: 'get' | 'put' | 'post',
    path: string,
    who?: keyof typeof users,
    address?: string,
  ) => {
    ip += 1;
    const server = request(app.getHttpServer());
    const req = server[method](`/api/admin/settings/email${path}`).set(
      'x-forwarded-for',
      address ?? `2001:db8:${run.slice(0, 4)}::${ip.toString(16)}`,
    );
    return who ? req.set('x-test-user', users[who]) : req;
  };
  const settings = (overrides: Record<string, unknown> = {}) => ({
    provider: 'resend',
    enabled: false,
    fromName: 'Vintrax',
    fromEmail: 'noreply@vintrax.ca',
    replyTo: 'support@vintrax.ca',
    ...overrides,
  });

  async function makeUser(label: string, role: UserRole, emailVerified = true) {
    const user = await prisma.user.create({
      data: {
        email: `${label}-${run}@example.test`,
        passwordHash: 'x',
        firstName: label,
        lastName: 'Test',
        role,
        status: 'ACTIVE',
        emailVerified,
      },
    });
    return user.id;
  }

  beforeAll(async () => {
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
    await prisma.emailProviderSettings.deleteMany({});
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => baseConfig] }),
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
        TestPlatformModule,
      ],
      controllers: [EmailSettingsController],
      providers: [
        { provide: APP_GUARD, useClass: TestAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    await app.init();
    mail = app.get(MailService);
    users.superAdmin = await makeUser('super', 'SUPER_ADMIN');
    users.admin = await makeUser('admin', 'ADMIN');
    users.unverified = await makeUser('unverified', 'SUPER_ADMIN', false);
  });

  afterAll(async () => {
    await prisma.emailProviderSettings.deleteMany({});
    await app.close();
    await closeTestPrisma();
    jest.restoreAllMocks();
    // The point of capturing them: no key was ever written to a log.
    const all = logs.join('\n');
    expect(all).not.toContain(KEY_ONE);
    expect(all).not.toContain(KEY_TWO);
  });

  describe('authorization', () => {
    it('is closed to an admin who is not a super admin, and to anyone signed out', async () => {
      await call('get', '', 'admin').expect(403);
      await call('put', '', 'admin')
        .send(settings({ apiKey: KEY_ONE }))
        .expect(403);
      await call('post', '/test-connection', 'admin').send({}).expect(403);
      await call('post', '/test-email', 'admin').send({}).expect(403);
      await call('get', '').expect(403);
      expect(await prisma.emailProviderSettings.count()).toBe(0);
    });

    it('opens to a super admin, starting from the environment settings', async () => {
      const response = await call('get', '', 'superAdmin').expect(200);
      expect(response.body).toMatchObject({
        enabled: false,
        encryptionConfigured: true,
        apiKey: { set: false, last4: null },
        active: { source: 'environment', driver: 'log' },
      });
    });
  });

  describe('validation', () => {
    it.each([
      ['a sender address that is not one', { fromEmail: 'nope' }],
      ['a sender name that could add a header', { fromName: 'Vintrax\r\nBcc: x@example.test' }],
      ['a key that is not a Resend key', { apiKey: 'sk_live_123456789' }],
      ['a field that is not a setting', { apiKeyCiphertext: 'x' }],
      ['an unknown provider', { provider: 'mailgun' }],
      ['replacing and removing the key at once', { apiKey: KEY_ONE, clearApiKey: true }],
    ])('refuses %s', async (_label, overrides) => {
      await call('put', '', 'superAdmin').send(settings(overrides)).expect(400);
    });

    it('refuses to switch on without a key', async () => {
      const response = await call('put', '', 'superAdmin')
        .send(settings({ enabled: true }))
        .expect(400);
      expect(JSON.stringify(response.body)).toMatch(/API key/);
    });
  });

  describe('the API key', () => {
    it('is stored encrypted and never returned, logged or audited', async () => {
      const response = await call('put', '', 'superAdmin')
        .send(settings({ apiKey: KEY_ONE }))
        .expect(200);
      expect(JSON.stringify(response.body)).not.toContain(KEY_ONE);
      expect(response.body.apiKey).toEqual({
        set: true,
        last4: KEY_ONE.slice(-4),
        updatedAt: expect.any(String),
        decryptable: true,
      });

      const row = await prisma.emailProviderSettings.findUniqueOrThrow({ where: { id: 1 } });
      expect(JSON.stringify(row)).not.toContain(KEY_ONE);
      expect(row.apiKeyCiphertext).toBeTruthy();
      expect(row.apiKeyIv).toBeTruthy();
      expect(row.apiKeyTag).toBeTruthy();

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'settings.email_updated', actorId: users.superAdmin },
        orderBy: { createdAt: 'desc' },
      });
      expect(JSON.stringify(audit)).not.toContain(KEY_ONE);
      expect(audit.metadata).toMatchObject({ changes: expect.arrayContaining(['apiKey.added']) });

      // A later read still shows only the mask.
      const again = await call('get', '', 'superAdmin').expect(200);
      expect(JSON.stringify(again.body)).not.toContain(KEY_ONE);
    });

    it('keeps the stored key when the field is left out, and replaces it when a new one is given', async () => {
      await call('put', '', 'superAdmin')
        .send(settings({ fromName: 'Vintrax Team' }))
        .expect(200);
      expect((await call('get', '', 'superAdmin')).body.apiKey.last4).toBe(KEY_ONE.slice(-4));

      const response = await call('put', '', 'superAdmin')
        .send(settings({ apiKey: KEY_TWO }))
        .expect(200);
      expect(response.body.apiKey.last4).toBe(KEY_TWO.slice(-4));
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'settings.email_updated', actorId: users.superAdmin },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.metadata).toMatchObject({
        changes: expect.arrayContaining(['apiKey.replaced']),
      });
      expect(JSON.stringify(audit)).not.toContain(KEY_TWO);
    });

    it('cannot be read on a server with a different encryption key', async () => {
      const other = new EmailSettingsService(
        prisma,
        new ConfigService({
          ...baseConfig,
          SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
        }) as never,
        factory,
      );
      const view = await other.view();
      expect(view.apiKey).toMatchObject({ set: true, decryptable: false });
      // And it is never used there: the environment stays in force.
      await prisma.emailProviderSettings.update({ where: { id: 1 }, data: { enabled: true } });
      expect((await other.active()).source).toBe('environment');
      await prisma.emailProviderSettings.update({ where: { id: 1 }, data: { enabled: false } });
    });

    it('cannot be stored on a server without an encryption key', async () => {
      const unconfigured = new EmailSettingsService(
        prisma,
        new ConfigService({ ...baseConfig, SETTINGS_ENCRYPTION_KEY: undefined }) as never,
        factory,
      );
      await expect(
        unconfigured.update(settings({ apiKey: KEY_ONE }) as never, users.superAdmin),
      ).rejects.toThrow(/SETTINGS_ENCRYPTION_KEY/);
      expect((await unconfigured.view()).encryptionConfigured).toBe(false);
    });
  });

  describe('sending through the stored settings', () => {
    it('switches registration, reset, alerts and CRM email to the configured provider and sender', async () => {
      await call('put', '', 'superAdmin')
        .send(settings({ enabled: true, fromName: 'Vintrax Team', replyTo: 'help@vintrax.ca' }))
        .expect(200);
      const view = (await call('get', '', 'superAdmin')).body;
      expect(view.active).toMatchObject({
        source: 'database',
        driver: 'resend',
        from: 'Vintrax Team <noreply@vintrax.ca>',
      });

      // A platform email (the reset path) …
      await mail.sendPasswordReset(`reset-${run}@example.test`, 'a'.repeat(64), 'Dana');
      // … and a CRM delivery both go through the stored key's client.
      await mail.deliver({
        to: `lead-${run}@example.test`,
        subject: 'Hello',
        text: 'Hello',
        replyTo: 'dealer@example.test',
      });
      await mail.flush();
      const stub = transports.get(KEY_TWO)!;
      // The reset goes out in the background, so the order is not fixed.
      const reset = stub.sent.find((m) => m.subject === 'Reset your Vintrax password')!;
      const crm = stub.sent.find((m) => m.subject === 'Hello')!;
      expect(reset).toMatchObject({
        from: 'Vintrax Team <noreply@vintrax.ca>',
        replyTo: 'help@vintrax.ca',
      });
      expect(crm).toMatchObject({
        from: 'Vintrax Team <noreply@vintrax.ca>',
        replyTo: 'dealer@example.test',
      });
      expect(
        transports.has(KEY_ONE) && transports.get(KEY_ONE)!.send.mock.calls.length,
      ).toBeFalsy();
    });

    it('goes back to the environment when the key is removed', async () => {
      const response = await call('put', '', 'superAdmin')
        .send(settings({ enabled: true, clearApiKey: true }))
        .expect(200);
      expect(response.body).toMatchObject({
        enabled: false,
        apiKey: { set: false },
        active: { source: 'environment', driver: 'log' },
      });
      await call('put', '', 'superAdmin')
        .send(settings({ apiKey: KEY_TWO }))
        .expect(200);
    });
  });

  describe('test connection', () => {
    it('checks a typed key without storing it', async () => {
      const typed = `re_${randomBytes(18).toString('hex')}`;
      const response = await call('post', '/test-connection', 'superAdmin')
        .send({ apiKey: typed, fromEmail: 'noreply@vintrax.ca' })
        .expect(200);
      expect(response.body).toMatchObject({ ok: true, keyValid: true, domain: { verified: true } });
      expect(transports.get(typed)!.checkConnection).toHaveBeenCalledWith('noreply@vintrax.ca');
      const row = await prisma.emailProviderSettings.findUniqueOrThrow({ where: { id: 1 } });
      expect(row.apiKeyLast4).toBe(KEY_TWO.slice(-4));
    });

    it('reports an unverified domain, a refused key and a sending-only key plainly', async () => {
      connection.next = {
        keyValid: true,
        restricted: false,
        domain: { name: 'vintrax.ca', status: 'pending', verified: false },
        error: null,
      };
      let response = await call('post', '/test-connection', 'superAdmin').send({}).expect(200);
      expect(response.body).toMatchObject({ ok: false, keyValid: true });
      expect(response.body.message).toMatch(/pending/);

      connection.next = {
        keyValid: false,
        restricted: false,
        domain: null,
        error: 'Resend refused the key (invalid_api_key)',
      };
      response = await call('post', '/test-connection', 'superAdmin').send({}).expect(200);
      expect(response.body).toMatchObject({ ok: false, keyValid: false });

      connection.next = { keyValid: true, restricted: true, domain: null, error: null };
      response = await call('post', '/test-connection', 'superAdmin').send({}).expect(200);
      expect(response.body).toMatchObject({ ok: true, restricted: true });
      connection.next = {
        keyValid: true,
        restricted: false,
        domain: { name: 'vintrax.ca', status: 'verified', verified: true },
        error: null,
      };
    });

    it('is rate-limited per address', async () => {
      const address = `2001:db8:${run.slice(0, 4)}:ffff::1`;
      for (let i = 0; i < 5; i += 1) {
        await call('post', '/test-connection', 'superAdmin', address).send({}).expect(200);
      }
      await call('post', '/test-connection', 'superAdmin', address).send({}).expect(429);
    });
  });

  describe('test email', () => {
    it("goes only to the admin's own verified address, through the active provider", async () => {
      await call('post', '/test-email', 'unverified').send({}).expect(400);
      await call('put', '', 'superAdmin')
        .send(settings({ enabled: true }))
        .expect(200);

      const response = await call('post', '/test-email', 'superAdmin').send({
        to: 'someone@else.test',
      });
      // The body names no recipient — an extra field is ignored, not obeyed.
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        to: `super-${run}@example.test`,
        providerMessageId: expect.stringMatching(/^em_/),
      });
      const last = transports.get(KEY_TWO)!.sent.at(-1)!;
      expect(last.to).toBe(`super-${run}@example.test`);
      expect(last.subject).toBe('Vintrax test email');
    });

    it('allows at most ten an hour per admin', async () => {
      await prisma.emailMessage.createMany({
        data: Array.from({ length: 10 }, (_, i) => ({
          category: 'ACCOUNT' as const,
          templateKey: 'settings.test-email',
          toEmail: `super-${run}@example.test`,
          subject: 'Vintrax test email',
          status: 'ACCEPTED' as const,
          userId: users.superAdmin,
          idempotencyKey: `test:${run}:limit:${i}`,
        })),
      });
      await call('post', '/test-email', 'superAdmin').send({}).expect(429);
    });
  });
});
