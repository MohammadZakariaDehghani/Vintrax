import { randomUUID } from 'node:crypto';
import {
  Global,
  Injectable,
  Module,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { UserRole } from '@vintrax/shared';
import request from 'supertest';
import type { AuthUser } from '../../common/auth/auth-user';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import {
  MailDeliveryError,
  MailService,
  type RichMailMessage,
} from '../../common/mail/mail.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../../common/queue/queue.service';
import { closeTestPrisma, describeDb, testPrisma } from '../accounting/testing/harness';
import { CrmScheduler } from './automation/scheduler.service';
import { CrmModule } from './crm.module';

/**
 * Both CRMs end to end over a real database: the real controllers, guards,
 * validation, services, outbox, dispatcher and automation engine. Only
 * authentication (a test header) and the mail transport are stood in for.
 *
 * The transport fails on purpose for some addresses: `bounce-…` is refused
 * permanently (a 5xx), `flaky-…` fails once and then delivers.
 */

const delivered: RichMailMessage[] = [];
const flakyOnce = new Set<string>();

const mail = {
  send: jest.fn(async () => undefined),
  deliver: jest.fn(async (message: RichMailMessage) => {
    if (message.to.startsWith('bounce-'))
      throw new MailDeliveryError('550 5.1.1 No such user', true);
    if (message.to.startsWith('flaky-') && !flakyOnce.has(message.to)) {
      flakyOnce.add(message.to);
      throw new MailDeliveryError('421 Try again later', false);
    }
    delivered.push(message);
    return { provider: 'test', messageId: randomUUID() };
  }),
};

@Injectable()
class TestAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: AuthUser }>();
    const id = req.headers['x-test-user'];
    if (!id) return true;
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

@Global()
@Module({
  providers: [
    { provide: PrismaService, useFactory: () => testPrisma() },
    { provide: MailService, useValue: mail },
    { provide: QueueService, useValue: { registerWorker: jest.fn(), add: jest.fn() } },
  ],
  exports: [PrismaService, MailService, QueueService],
})
class TestPlatformModule {}

describeDb('CRM API', () => {
  const prisma = testPrisma();
  let app: INestApplication;
  let scheduler: CrmScheduler;
  const suffix = randomUUID().slice(0, 8);
  const users = {
    owner: '',
    rep: '',
    accountant: '',
    otherOwner: '',
    buyer: '',
    otherBuyer: '',
    admin: '',
  };
  let dealerId = '';
  const statusId: Record<string, string> = {};

  async function makeUser(label: string, role: UserRole = 'BUYER') {
    const user = await prisma.user.create({
      data: {
        email: `${label}-${suffix}@example.test`,
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

  const as = (who: keyof typeof users) => {
    const server = () => request(app.getHttpServer());
    return {
      get: (url: string) => server().get(url).set('x-test-user', users[who]),
      post: (url: string) => server().post(url).set('x-test-user', users[who]),
      put: (url: string) => server().put(url).set('x-test-user', users[who]),
    };
  };

  /** Runs the scheduler as if it were `minutesAhead` from now: due steps, then due email. */
  const tick = (minutesAhead = 0) => scheduler.tick(new Date(Date.now() + minutesAhead * 60_000));

  const createLead = async (body: Record<string, unknown>, who: keyof typeof users = 'owner') => {
    const response = await as(who)
      .post('/api/crm/leads')
      .send({ tags: [], ...body });
    expect(response.status).toBe(201);
    return response.body.id as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              APP_URL: 'https://vintrax.test',
              JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret',
              CRM_SCHEDULER_ENABLED: false,
              CRM_SCHEDULER_INTERVAL_MS: 15000,
              CRM_EMAIL_MAX_ATTEMPTS: 3,
              CRM_EMAIL_TRACKING: true,
            }),
          ],
        }),
        TestPlatformModule,
        CrmModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: TestAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    scheduler = moduleRef.get(CrmScheduler);

    users.owner = await makeUser('owner', 'DEALER');
    users.rep = await makeUser('rep');
    users.accountant = await makeUser('accountant');
    users.otherOwner = await makeUser('other', 'DEALER');
    users.buyer = await makeUser('buyer');
    users.otherBuyer = await makeUser('buyer2');
    users.admin = await makeUser('admin', 'ADMIN');
    const dealer = await prisma.dealer.create({
      data: {
        ownerId: users.owner,
        name: `CRM Motors ${suffix}`,
        slug: `crm-motors-${suffix}`,
        province: 'ON',
      },
    });
    dealerId = dealer.id;
    await prisma.dealer.create({
      data: {
        ownerId: users.otherOwner,
        name: `Other Motors ${suffix}`,
        slug: `other-motors-${suffix}`,
        province: 'BC',
      },
    });
    await prisma.dealerMember.createMany({
      data: [
        { dealerId, userId: users.rep, role: 'SALES_USER' },
        { dealerId, userId: users.accountant, role: 'ACCOUNTANT' },
      ],
    });
  });

  afterAll(async () => {
    await app?.close();
    await closeTestPrisma();
  });

  describe('dealer CRM', () => {
    it('sets up a dealership on first use and lets only managers change settings', async () => {
      const me = await as('owner').get('/api/crm/me').expect(200);
      expect(me.body.me.role).toBe('OWNER');
      for (const status of me.body.statuses as Array<{ id: string; key: string }>)
        statusId[status.key] = status.id;
      expect(Object.keys(statusId)).toEqual(
        expect.arrayContaining(['NEW', 'CONTACTED', 'WON', 'LOST']),
      );

      const settings = {
        timezone: 'America/Toronto',
        sendWindowStartHour: 0,
        sendWindowEndHour: 24,
        sendDays: [0, 1, 2, 3, 4, 5, 6],
        responseTargetMinutes: 5,
        noResponseDays: 3,
        inactiveDays: 30,
        assignmentMode: 'MANUAL',
        createFollowUpTask: true,
        senderName: 'CRM Motors',
        replyToEmail: 'sales@crm-motors.test',
        businessAddress: '1 Main Street, Toronto, ON M5V 1A1',
        businessPhone: '416-555-0100',
        businessEmail: 'sales@crm-motors.test',
        impliedConsentFromInquiry: true,
        impliedConsentFromPurchase: true,
        postSaleEnabled: true,
      };
      await as('rep').put('/api/crm/settings').send(settings).expect(403);
      await as('owner').put('/api/crm/settings').send(settings).expect(200);
    });

    it('keeps the CRM from buyers, administrators and other dealerships', async () => {
      const leadId = await createLead({
        firstName: 'Private',
        lastName: 'Lead',
        email: `private-${suffix}@example.test`,
      });
      await as('buyer').get('/api/crm/leads').expect(403);
      await as('admin').get('/api/crm/leads').expect(403);
      await as('otherOwner').get(`/api/crm/leads/${leadId}`).expect(404);
      // A dealership the caller does not belong to cannot be chosen by header.
      await as('otherOwner').get('/api/crm/leads').set('x-dealer-id', dealerId).expect(403);
    });

    it('shows a sales user only their own and unassigned leads', async () => {
      const ownersLead = await createLead({
        firstName: 'Owner',
        lastName: 'Only',
        phone: '416-555-0101',
        assignedToId: users.owner,
      });
      const repsLead = await createLead({
        firstName: 'Rep',
        lastName: 'Lead',
        phone: '416-555-0102',
        assignedToId: users.rep,
      });
      await as('rep').get(`/api/crm/leads/${ownersLead}`).expect(404);
      await as('rep').get(`/api/crm/leads/${repsLead}`).expect(200);
      const list = await as('rep').get('/api/crm/leads?pageSize=100').expect(200);
      const ids = (list.body.items as Array<{ id: string }>).map((row) => row.id);
      expect(ids).toContain(repsLead);
      expect(ids).not.toContain(ownersLead);
      // Accountants can read but not change leads.
      await as('accountant').get(`/api/crm/leads/${ownersLead}`).expect(200);
      await as('accountant')
        .post(`/api/crm/leads/${ownersLead}/status`)
        .send({ statusId: statusId['CONTACTED'] })
        .expect(403);
      await as('rep')
        .post(`/api/crm/leads/${repsLead}/merge`)
        .send({ duplicateId: ownersLead })
        .expect(403);
    });

    it('creates a lead with a follow-up task and records consent', async () => {
      const leadId = await createLead({
        firstName: 'Ava',
        lastName: 'Martin',
        email: `ava-${suffix}@example.test`,
        phone: '416-555-0123',
        assignedToId: users.rep,
        consent: { type: 'EXPRESS', source: 'Showroom form', evidence: 'Ticked the box' },
      });
      const lead = await as('owner').get(`/api/crm/leads/${leadId}`).expect(200);
      expect(lead.body.status.key).toBe('NEW');
      expect(lead.body.assignedTo.id).toBe(users.rep);
      expect(lead.body.tasks.length).toBeGreaterThanOrEqual(1);
      expect(lead.body.marketingAllowed).toBe(true);
      const audit = await prisma.crmAuditLog.findFirst({
        where: { dealerId, entityId: leadId, action: 'lead.created' },
      });
      expect(audit).not.toBeNull();
    });

    it('requires a reason to mark a lead lost', async () => {
      const leadId = await createLead({
        firstName: 'Lost',
        lastName: 'Cause',
        phone: '416-555-0103',
      });
      await as('owner')
        .post(`/api/crm/leads/${leadId}/status`)
        .send({ statusId: statusId['LOST'] })
        .expect(400);
      await as('owner')
        .post(`/api/crm/leads/${leadId}/status`)
        .send({ statusId: statusId['LOST'], lostReason: 'Bought elsewhere' })
        .expect(201);
      const lead = await as('owner').get(`/api/crm/leads/${leadId}`).expect(200);
      expect(lead.body.status.key).toBe('LOST');
    });

    it('finds duplicates and merges them without losing history', async () => {
      const email = `dupe-${suffix}@example.test`;
      const first = await createLead({ firstName: 'Dana', lastName: 'Dupe', email });
      const second = await createLead({
        firstName: 'Dana',
        lastName: 'Dupe',
        email: email.toUpperCase(),
        phone: '416-555-0199',
      });
      await as('owner')
        .post(`/api/crm/leads/${second}/activities`)
        .send({ type: 'CALL', title: 'Called about financing' })
        .expect(201);
      const dupes = await as('owner').get(`/api/crm/leads/${first}/duplicates`).expect(200);
      const match = (dupes.body as Array<{ id: string; reasons: string[] }>).find(
        (row) => row.id === second,
      );
      expect(match?.reasons).toEqual(expect.arrayContaining(['EMAIL', 'NAME']));

      await as('owner')
        .post(`/api/crm/leads/${first}/merge`)
        .send({ duplicateId: second })
        .expect(201);
      const merged = await prisma.crmLead.findUniqueOrThrow({ where: { id: first } });
      expect(merged.phone).toBe('416-555-0199');
      expect((await prisma.crmLead.findUniqueOrThrow({ where: { id: second } })).mergedIntoId).toBe(
        first,
      );
      expect(
        await prisma.crmActivity.count({
          where: { leadId: first, title: 'Called about financing' },
        }),
      ).toBe(1);
      await as('owner')
        .post(`/api/crm/leads/${first}/merge`)
        .send({ duplicateId: first })
        .expect(400);
    });

    it('scores a lead up when a test drive is completed', async () => {
      const leadId = await createLead({
        firstName: 'Tess',
        lastName: 'Drive',
        phone: '416-555-0104',
      });
      const before = (await as('owner').get(`/api/crm/leads/${leadId}`).expect(200)).body
        .score as number;
      const startsAt = new Date(Date.now() + 86_400_000);
      const appointment = await as('owner')
        .post('/api/crm/appointments')
        .send({
          leadId,
          type: 'TEST_DRIVE',
          startsAt: startsAt.toISOString(),
          endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
        })
        .expect(201);
      await as('owner')
        .post(`/api/crm/appointments/${appointment.body.id}/status`)
        .send({ status: 'COMPLETED' })
        .expect(201);
      const after = await as('owner').get(`/api/crm/leads/${leadId}`).expect(200);
      expect(after.body.score).toBeGreaterThan(before);
      expect(
        after.body.journey.find((step: { key: string }) => step.key === 'TEST_DRIVE').reachedAt,
      ).not.toBeNull();
    });
  });

  describe('dealer email', () => {
    it('sends a composed email, then counts it as first contact', async () => {
      const leadId = await createLead({
        firstName: 'Eve',
        lastName: 'Mail',
        email: `eve-${suffix}@example.test`,
      });
      const composed = await as('owner')
        .post('/api/crm/emails')
        .send({
          leadId,
          subject: 'Hello {{customer.first_name}}',
          bodyHtml: '<p>See <a href="https://vintrax.test/x">this</a><script>x()</script></p>',
          purpose: 'TRANSACTIONAL',
        })
        .expect(201);
      await tick();
      const email = await prisma.crmEmail.findUniqueOrThrow({ where: { id: composed.body.id } });
      expect(email.status).toBe('SENT');
      expect(email.subject).toBe('Hello Eve');
      const sent = delivered.find((message) => message.to === `eve-${suffix}@example.test`)!;
      expect(sent.html).not.toContain('<script');
      expect(sent.html).toContain('/api/crm/t/c/'); // links tracked
      expect(sent.html).toContain('1 Main Street'); // sender identified
      expect(sent.headers?.['List-Unsubscribe']).toBeUndefined(); // transactional
      const lead = await as('owner').get(`/api/crm/leads/${leadId}`).expect(200);
      expect(lead.body.firstContactAt).not.toBeNull();
      expect(lead.body.status.key).toBe('CONTACTED');
    });

    it('retries a temporary failure with back-off and sends once', async () => {
      const address = `flaky-${suffix}@example.test`;
      const leadId = await createLead({ firstName: 'Flo', lastName: 'Flaky', email: address });
      const composed = await as('owner')
        .post('/api/crm/emails')
        .send({ leadId, subject: 'Hi', bodyHtml: '<p>Hi</p>', purpose: 'TRANSACTIONAL' })
        .expect(201);
      await tick();
      let email = await prisma.crmEmail.findUniqueOrThrow({ where: { id: composed.body.id } });
      expect(email.status).toBe('QUEUED');
      expect(email.attempts).toBe(1);
      expect(email.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
      await tick(); // not due yet
      expect((await prisma.crmEmail.findUniqueOrThrow({ where: { id: email.id } })).attempts).toBe(
        1,
      );
      await tick(2);
      email = await prisma.crmEmail.findUniqueOrThrow({ where: { id: email.id } });
      expect(email.status).toBe('SENT');
      expect(email.attempts).toBe(2);
      expect(delivered.filter((message) => message.to === address)).toHaveLength(1);
    });

    it('suppresses an address that hard-bounced, for every dealership', async () => {
      const address = `bounce-${suffix}@example.test`;
      const leadId = await createLead({ firstName: 'Bo', lastName: 'Bounce', email: address });
      const composed = await as('owner')
        .post('/api/crm/emails')
        .send({ leadId, subject: 'Hi', bodyHtml: '<p>Hi</p>', purpose: 'TRANSACTIONAL' })
        .expect(201);
      await tick();
      expect(
        (await prisma.crmEmail.findUniqueOrThrow({ where: { id: composed.body.id } })).status,
      ).toBe('BOUNCED');
      const suppression = await prisma.crmSuppression.findFirst({
        where: { email: address, dealerId: null },
      });
      expect(suppression?.reason).toBe('HARD_BOUNCE');
      await as('owner')
        .post('/api/crm/emails')
        .send({ leadId, subject: 'Again', bodyHtml: '<p>Hi</p>', purpose: 'TRANSACTIONAL' })
        .expect(400);
    });

    it('sends marketing only with consent, with an unsubscribe link that works', async () => {
      const noConsent = await createLead({
        firstName: 'Nora',
        lastName: 'None',
        email: `nora-${suffix}@example.test`,
      });
      await as('owner')
        .post('/api/crm/emails')
        .send({ leadId: noConsent, subject: 'Sale', bodyHtml: '<p>Sale</p>', purpose: 'MARKETING' })
        .expect(400);

      const address = `mark-${suffix}@example.test`;
      const leadId = await createLead({
        firstName: 'Mark',
        lastName: 'Eting',
        email: address,
        consent: { type: 'EXPRESS', source: 'Website form' },
      });
      const composed = await as('owner')
        .post('/api/crm/emails')
        .send({ leadId, subject: 'Sale', bodyHtml: '<p>Sale</p>', purpose: 'MARKETING' })
        .expect(201);
      await tick();
      const email = await prisma.crmEmail.findUniqueOrThrow({ where: { id: composed.body.id } });
      expect(email.status).toBe('SENT');
      const sent = delivered.find((message) => message.to === address)!;
      expect(sent.headers?.['List-Unsubscribe']).toContain(
        `/api/crm/public/unsubscribe/${email.trackingToken}`,
      );
      expect(sent.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(sent.html).toContain(`/unsubscribe?t=${email.trackingToken}`);

      const info = await request(app.getHttpServer())
        .get(`/api/crm/public/unsubscribe/${email.trackingToken}`)
        .expect(200);
      expect(info.body.email).not.toBe(address); // masked
      expect(info.body.unsubscribed).toBe(false);
      await request(app.getHttpServer())
        .post(`/api/crm/public/unsubscribe/${email.trackingToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/crm/public/unsubscribe/not-a-real-token-at-all')
        .expect(404);

      await as('owner')
        .post('/api/crm/emails')
        .send({ leadId, subject: 'Another sale', bodyHtml: '<p>Sale</p>', purpose: 'MARKETING' })
        .expect(400);
      // Unsubscribing from marketing does not stop service email.
      await as('owner')
        .post('/api/crm/emails')
        .send({
          leadId,
          subject: 'Your appointment',
          bodyHtml: '<p>See you</p>',
          purpose: 'TRANSACTIONAL',
        })
        .expect(201);
    });

    it('records opens and clicks and refuses forged click links', async () => {
      const email = await prisma.crmEmail.findFirstOrThrow({
        where: { dealerId, status: 'SENT', toEmail: `eve-${suffix}@example.test` },
      });
      await request(app.getHttpServer())
        .get(`/api/crm/t/o/${email.trackingToken}.gif`)
        .expect(200)
        .expect('Content-Type', 'image/gif');
      const sent = delivered.find((message) => message.to === email.toEmail)!;
      const href = /href="([^"]*\/api\/crm\/t\/c\/[^"]*)"/
        .exec(sent.html!)![1]!
        .replace(/&amp;/g, '&');
      const path = href.replace('https://vintrax.test', '');
      const good = await request(app.getHttpServer()).get(path).expect(302);
      expect(good.headers['location']).toBe('https://vintrax.test/x');
      const forged = await request(app.getHttpServer())
        .get(
          path.replace(
            encodeURIComponent('https://vintrax.test/x'),
            encodeURIComponent('https://evil.example/'),
          ),
        )
        .expect(302);
      expect(forged.headers['location']).toBe('https://vintrax.test');
      const tracked = await prisma.crmEmail.findUniqueOrThrow({ where: { id: email.id } });
      expect(tracked.openedAt).not.toBeNull();
      expect(tracked.clickedAt).not.toBeNull();
    });
  });

  describe('automations', () => {
    it('runs a sequence: email, wait, branch, and stops when the customer replies', async () => {
      const created = await as('owner')
        .post('/api/crm/automations')
        .send({
          name: `Test sequence ${suffix}`,
          trigger: 'LEAD_CREATED',
          steps: [
            {
              id: 'intro',
              type: 'SEND_EMAIL',
              next: 'wait',
              config: { templateKey: 'NEW_LEAD_INTRO' },
            },
            { id: 'wait', type: 'WAIT', next: 'check', config: { minutes: 60 } },
            {
              id: 'check',
              type: 'CONDITION',
              yes: 'done',
              no: 'task',
              config: { conditions: [{ field: 'lead.has_replied', op: 'is_true' }] },
            },
            { id: 'task', type: 'CREATE_TASK', config: { title: 'Call — no reply to intro' } },
            { id: 'done', type: 'STOP' },
          ],
          stopConditions: ['REPLIED', 'WON', 'LOST', 'UNSUBSCRIBED'],
          respectSendWindow: false,
          isActive: true,
        })
        .expect(201);
      const automationId = created.body.id as string;

      // A lead that never replies: intro, wait, then a task.
      const quiet = await createLead({
        firstName: 'Quinn',
        lastName: 'Quiet',
        email: `quinn-${suffix}@example.test`,
      });
      await tick();
      await tick();
      let enrollment = await prisma.crmAutomationEnrollment.findFirstOrThrow({
        where: { automationId, leadId: quiet },
      });
      // The intro went out and the wait began; the check is next.
      expect(enrollment.status).toBe('WAITING');
      expect(enrollment.currentStepId).toBe('check');
      const intro = await prisma.crmEmail.findFirstOrThrow({
        where: { leadId: quiet, enrollmentId: enrollment.id },
      });
      expect(intro.idempotencyKey).toBe(`auto:${enrollment.id}:intro`);
      expect(intro.status).toBe('SENT');
      await tick(61);
      enrollment = await prisma.crmAutomationEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      });
      expect(enrollment.status).toBe('COMPLETED');
      expect(
        await prisma.crmTask.count({
          where: { leadId: quiet, title: { startsWith: 'Call — no reply to intro' } },
        }),
      ).toBe(1);
      // Running again sends nothing twice.
      await tick(120);
      expect(
        await prisma.crmEmail.count({ where: { leadId: quiet, enrollmentId: enrollment.id } }),
      ).toBe(1);

      // A lead who replies is taken out before the next step.
      const chatty = await createLead({
        firstName: 'Chad',
        lastName: 'Chatty',
        email: `chad-${suffix}@example.test`,
      });
      await tick();
      await tick();
      const email = await prisma.crmEmail.findFirstOrThrow({
        where: { leadId: chatty, enrollmentId: { not: null } },
      });
      await as('owner').post(`/api/crm/emails/${email.id}/replied`).expect(201);
      await tick(61);
      const stopped = await prisma.crmAutomationEnrollment.findFirstOrThrow({
        where: { automationId, leadId: chatty },
      });
      expect(stopped.status).toBe('STOPPED');
      expect(
        await prisma.crmTask.count({
          where: { leadId: chatty, title: { startsWith: 'Call — no reply to intro' } },
        }),
      ).toBe(0);

      // A loop is refused before it is saved.
      await as('owner')
        .post('/api/crm/automations')
        .send({
          name: 'Loop',
          trigger: 'LEAD_CREATED',
          steps: [
            { id: 'a', type: 'WAIT', next: 'b', config: { minutes: 5 } },
            { id: 'b', type: 'WAIT', next: 'a', config: { minutes: 5 } },
          ],
        })
        .expect(400);
      await as('owner')
        .post(`/api/crm/automations/${automationId}/active`)
        .send({ isActive: false })
        .expect(201);
      await as('rep')
        .post(`/api/crm/automations/${automationId}/active`)
        .send({ isActive: true })
        .expect(403);
    });
  });

  describe('support CRM', () => {
    let ticketId = '';

    it('opens a ticket from the portal and keeps internal notes from the requester', async () => {
      const categories = await as('buyer').get('/api/support/categories').expect(200);
      const created = await as('buyer')
        .post('/api/support/tickets')
        .send({
          subject: 'Photos will not upload',
          description: 'The upload spins forever.',
          categoryId: categories.body[0]?.id ?? null,
        })
        .expect(201);
      ticketId = created.body.id;

      const admin = await as('admin').get(`/api/admin/crm/tickets/${ticketId}`).expect(200);
      expect(admin.body.requesterId ?? admin.body.requester?.id).toBe(users.buyer);
      await as('admin')
        .post(`/api/admin/crm/tickets/${ticketId}/messages`)
        .send({ body: 'Internal: the HEIC converter again', visibility: 'INTERNAL' })
        .expect(201);
      await as('admin')
        .post(`/api/admin/crm/tickets/${ticketId}/messages`)
        .send({ body: 'Could you try a JPEG?', visibility: 'PUBLIC' })
        .expect(201);

      const mine = await as('buyer').get(`/api/support/tickets/${ticketId}`).expect(200);
      expect(JSON.stringify(mine.body)).not.toContain('HEIC');
      // The description opens the conversation; the agent's public reply follows; the note is absent.
      expect(mine.body.messages.map((message: { body: string }) => message.body)).toEqual([
        'The upload spins forever.',
        'Could you try a JPEG?',
      ]);
      expect(mine.body.status).toBe('WAITING_FOR_USER');
      const list = await as('buyer').get('/api/support/tickets').expect(200);
      expect(JSON.stringify(list.body)).not.toContain('HEIC');

      const full = await as('admin').get(`/api/admin/crm/tickets/${ticketId}`).expect(200);
      expect(JSON.stringify(full.body)).toContain('HEIC');
    });

    it('reopens on the requester reply and hides tickets from everyone else', async () => {
      await as('buyer')
        .post(`/api/support/tickets/${ticketId}/replies`)
        .send({ body: 'JPEG works, thanks' })
        .expect(201);
      const ticket = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
      expect(ticket.status).not.toBe('WAITING_FOR_USER');
      expect(ticket.lastPublicReplyBy).toBe('REQUESTER');
      await as('otherBuyer').get(`/api/support/tickets/${ticketId}`).expect(404);
      await as('otherBuyer')
        .post(`/api/support/tickets/${ticketId}/replies`)
        .send({ body: 'hi' })
        .expect(404);
    });

    it('is for administrators only', async () => {
      for (const who of ['owner', 'rep', 'buyer'] as const) {
        await as(who).get('/api/admin/crm/tickets').expect(403);
        await as(who).get(`/api/admin/crm/tickets/${ticketId}`).expect(403);
        await as(who).get(`/api/admin/crm/dealers/${dealerId}`).expect(403);
      }
      await as('admin').get('/api/admin/crm/overview').expect(200);
      await as('admin').get(`/api/admin/crm/dealers/${dealerId}`).expect(200);
      await as('admin').get(`/api/admin/crm/users/${users.buyer}`).expect(200);
    });
  });

  it('keeps the CRM audit log append-only', async () => {
    const row = await prisma.crmAuditLog.findFirstOrThrow({ where: { dealerId } });
    await expect(
      prisma.$executeRaw`UPDATE "CrmAuditLog" SET action = 'tampered' WHERE id = ${row.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`DELETE FROM "CrmAuditLog" WHERE id = ${row.id}::uuid`,
    ).rejects.toThrow();
  });
});
