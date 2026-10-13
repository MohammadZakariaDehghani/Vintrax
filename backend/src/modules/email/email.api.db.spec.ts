import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  Global,
  Injectable,
  Module,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { UserRole } from '@vintrax/shared';
import request from 'supertest';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { IS_PUBLIC_KEY } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { MailService } from '../../common/mail/mail.service';
import type { ResendTransport } from '../../common/mail/resend.transport';
import { PrismaService } from '../../common/prisma/prisma.service';
import { closeTestPrisma, describeDb, testPrisma } from '../accounting/testing/harness';
import { DispatcherService } from '../crm/email/dispatcher.service';
import { EmailAdminController } from './email-admin.controller';
import { EmailWebhookController } from './email-webhook.controller';

/**
 * The Resend webhook and Admin → Emails over HTTP and a real database: the
 * real controllers, permission guard, raw-body signature check and services.
 * Sending goes through a stand-in Resend transport; the CRM dispatcher is a
 * spy, so what reaches the CRM is asserted without the whole CRM module.
 */

const key = randomBytes(24);
const SECRET = `whsec_${key.toString('base64')}`;

function signed(body: string, id = `msg_${randomUUID()}`, at = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', key).update(`${id}.${at}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(at), 'svix-signature': `v1,${signature}` };
}

@Injectable()
class TestAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: AuthUser }>();
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

const crm = { providerEvent: jest.fn(async () => false) };
const transport = {
  send: jest.fn(async () => ({ messageId: `em_${randomUUID()}` })),
} as unknown as ResendTransport;

@Global()
@Module({
  providers: [
    { provide: PrismaService, useFactory: () => testPrisma() },
    {
      provide: MailService,
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService, prisma: PrismaService) =>
        new MailService(config as never, prisma, transport),
    },
    { provide: DispatcherService, useValue: crm },
    AuditService,
  ],
  exports: [PrismaService, MailService, DispatcherService, AuditService],
})
class TestPlatformModule {}

describeDb('email webhook and admin API', () => {
  const prisma = testPrisma();
  let app: INestApplication;
  let mail: MailService;
  const run = randomUUID().slice(0, 8);
  const users = { admin: '', buyer: '' };

  async function makeUser(label: string, role: UserRole) {
    const user = await prisma.user.create({
      data: {
        email: `${label}-${run}@example.test`,
        passwordHash: 'x',
        firstName: label,
        lastName: 'Test',
        role,
        status: 'ACTIVE',
        emailVerified: true,
      },
    });
    return user.id;
  }

  /** A platform message as Resend accepted it; returns its row and provider id. */
  async function acceptedMessage(label: string) {
    const id = await mail.sendTemplate('auth.password-changed', `${label}-${run}@example.test`, {
      firstName: 'Dana',
      via: 'settings',
    });
    await mail.flush();
    return prisma.emailMessage.findUniqueOrThrow({ where: { id: id! } });
  }

  const webhook = (event: object, headers?: Record<string, string>) => {
    const body = JSON.stringify(event);
    return request(app.getHttpServer())
      .post('/api/webhooks/resend')
      .set('content-type', 'application/json')
      .set(headers ?? signed(body))
      .send(body);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'development',
              MAIL_DRIVER: 'resend',
              MAIL_FROM: 'Vintrax <noreply@vintrax.test>',
              APP_URL: 'https://vintrax.test',
              MAIL_ADMIN_TO: [],
              MAIL_NOTIFICATIONS_ENABLED: true,
              MAIL_MARKETING_ENABLED: true,
              MAIL_MAX_ATTEMPTS: 3,
              MAIL_ALERT_FAILURE_THRESHOLD: 1000,
              RESEND_WEBHOOK_SECRET: SECRET,
            }),
          ],
        }),
        TestPlatformModule,
      ],
      controllers: [EmailWebhookController, EmailAdminController],
      providers: [
        { provide: APP_GUARD, useClass: TestAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    mail = app.get(MailService);
    users.admin = await makeUser('admin', 'ADMIN');
    users.buyer = await makeUser('buyer', 'BUYER');
  });

  afterAll(async () => {
    await app.close();
    await closeTestPrisma();
  });

  describe('the webhook', () => {
    it('refuses an unsigned request and a bad signature without touching anything', async () => {
      const row = await acceptedMessage('unsigned');
      const event = { type: 'email.delivered', data: { email_id: row.providerMessageId } };
      await webhook(event, {}).expect(401);
      const forged = signed('{"something":"else"}');
      await webhook(event, forged).expect(401);
      expect((await prisma.emailMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('ACCEPTED');
    });

    it('refuses a captured delivery replayed later', async () => {
      const row = await acceptedMessage('replay');
      const event = { type: 'email.delivered', data: { email_id: row.providerMessageId } };
      const body = JSON.stringify(event);
      await webhook(event, signed(body, `msg_${randomUUID()}`, Math.floor(Date.now() / 1000) - 3600)).expect(401);
    });

    it('marks a message delivered, and only once per event id', async () => {
      const row = await acceptedMessage('delivered');
      const event = { type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: row.providerMessageId } };
      const body = JSON.stringify(event);
      const headers = signed(body);
      const first = await webhook(event, headers).expect(200);
      expect(first.body).toEqual({ received: true });
      const again = await webhook(event, headers).expect(200);
      expect(again.body).toEqual({ received: true, duplicate: true });
      const updated = await prisma.emailMessage.findUniqueOrThrow({ where: { id: row.id } });
      expect(updated.status).toBe('DELIVERED');
      expect(updated.deliveredAt).not.toBeNull();
      // The CRM is told too (it ignores ids that are not its own).
      expect(crm.providerEvent).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: row.providerMessageId, type: 'DELIVERED' }),
      );
      expect(await prisma.emailWebhookEvent.count({ where: { id: headers['svix-id'] } })).toBe(1);
    });

    it('keeps a complaint when a delivery event arrives after it', async () => {
      const row = await acceptedMessage('order');
      await webhook({ type: 'email.complained', data: { email_id: row.providerMessageId } }).expect(200);
      await webhook({ type: 'email.delivered', data: { email_id: row.providerMessageId } }).expect(200);
      expect((await prisma.emailMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('COMPLAINED');
    });

    it('suppresses the address after a hard bounce, taken from our record rather than the event', async () => {
      const row = await acceptedMessage('hard-bounce');
      await webhook({
        type: 'email.bounced',
        data: {
          email_id: row.providerMessageId,
          to: ['someone-else@example.test'],
          bounce: { type: 'Permanent', subType: 'General', message: `550 ${row.toEmail} unknown` },
        },
      }).expect(200);
      const updated = await prisma.emailMessage.findUniqueOrThrow({ where: { id: row.id } });
      expect(updated.status).toBe('BOUNCED');
      expect(updated.lastError).not.toContain(row.toEmail);
      expect(
        await prisma.crmSuppression.count({ where: { dealerId: null, email: row.toEmail, reason: 'HARD_BOUNCE' } }),
      ).toBe(1);
      expect(await prisma.crmSuppression.count({ where: { email: 'someone-else@example.test' } })).toBe(0);
    });

    it('acknowledges events it does not track and answers with no customer data', async () => {
      const response = await webhook({ type: 'contact.created', data: { email: 'x@example.test' } }).expect(200);
      expect(JSON.stringify(response.body)).not.toContain('@');
    });
  });

  describe('Admin → Emails', () => {
    it('is closed to anyone without email:read', async () => {
      await request(app.getHttpServer()).get('/api/admin/emails').set('x-test-user', users.buyer).expect(403);
      await request(app.getHttpServer()).get('/api/admin/emails').expect(403);
    });

    it('lists messages with sanitised detail and says which can be retried', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/admin/emails?q=${encodeURIComponent(`hard-bounce-${run}`)}`)
        .set('x-test-user', users.admin)
        .expect(200);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toMatchObject({ status: 'BOUNCED', retryable: false });
      expect(response.body.items[0]).not.toHaveProperty('payload');
    });

    it('reports statistics', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/admin/emails/stats?hours=1')
        .set('x-test-user', users.admin)
        .expect(200);
      expect(response.body).toMatchObject({ driver: 'resend' });
      expect(response.body.total).toBeGreaterThan(0);
    });

    it('retries a failed message unchanged, audited; refuses a secret-link one', async () => {
      const failed = await prisma.emailMessage.create({
        data: {
          category: 'SECURITY',
          templateKey: 'auth.password-changed',
          toEmail: `retry-${run}@example.test`,
          subject: 'Your Vintrax password was changed',
          status: 'FAILED',
          attempts: 3,
          idempotencyKey: `test:${run}:retry`,
          payload: { vars: { firstName: 'D', via: 'reset' }, replyTo: null },
        },
      });
      const secret = await prisma.emailMessage.create({
        data: {
          category: 'SECURITY',
          templateKey: 'auth.password-reset',
          toEmail: `retry-secret-${run}@example.test`,
          subject: 'Reset your Vintrax password',
          status: 'FAILED',
          idempotencyKey: `test:${run}:retry-secret`,
        },
      });
      await request(app.getHttpServer())
        .post(`/api/admin/emails/${failed.id}/retry`)
        .set('x-test-user', users.buyer)
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/admin/emails/${secret.id}/retry`)
        .set('x-test-user', users.admin)
        .expect(400);
      await request(app.getHttpServer())
        .post(`/api/admin/emails/${failed.id}/retry`)
        .set('x-test-user', users.admin)
        .expect(201);
      expect(await prisma.emailMessage.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({
        status: 'QUEUED',
        toEmail: `retry-${run}@example.test`,
        templateKey: 'auth.password-changed',
      });
      expect(
        await prisma.auditLog.count({ where: { action: 'email.retried', entityId: failed.id, actorId: users.admin } }),
      ).toBe(1);
    });
  });
});
