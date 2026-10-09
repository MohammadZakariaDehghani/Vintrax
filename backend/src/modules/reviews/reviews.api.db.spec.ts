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
import { AuditService } from '../../common/audit/audit.service';
import { IS_PUBLIC_KEY } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { MailService } from '../../common/mail/mail.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../../common/queue/queue.service';
import { RedisService } from '../../common/redis/redis.service';
import { closeTestPrisma, describeDb, testPrisma } from '../accounting/testing/harness';
import { ReviewsModule } from './reviews.module';

/**
 * Vehicle reviews end to end over a real database: the real controllers,
 * validation, permission guard and services. Authentication is a test
 * header; the caller's address is the X-Forwarded-For the test sends.
 */

@Injectable()
class TestAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: AuthUser }>();
    const id = req.headers['x-test-user'];
    if (!id) {
      const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, context.getHandler()) as
        boolean | undefined;
      return !!isPublic;
    }
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

const passThroughRedis = {
  remember: <T>(_key: string, _ttl: number, factory: () => Promise<T>) => factory(),
  del: async () => undefined,
};

@Global()
@Module({
  providers: [
    { provide: PrismaService, useFactory: () => testPrisma() },
    { provide: RedisService, useValue: passThroughRedis },
    { provide: MailService, useValue: { send: jest.fn(async () => undefined) } },
    { provide: QueueService, useValue: { registerWorker: jest.fn(), add: jest.fn() } },
    AuditService,
  ],
  exports: [PrismaService, RedisService, MailService, QueueService, AuditService],
})
class TestPlatformModule {}

describeDb('vehicle reviews API', () => {
  const prisma = testPrisma();
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const users = { seller: '', buyer: '', buyer2: '', admin: '' };
  let vehicleId = '';
  let draftVehicleId = '';
  let ipCounter = 0;
  /** A fresh address per call unless one is given, so limits do not leak between tests. */
  /**
   * A fresh address per call unless one is given, so limits do not leak between
   * tests — or between runs on the same database, which share the last hour.
   */
  const runPrefix = `2001:db8:${suffix.slice(0, 4)}:${suffix.slice(4, 8)}`;
  const freshIp = () => {
    ipCounter += 1;
    return `${runPrefix}::${ipCounter.toString(16)}`;
  };
  /** A fixed address for one test in this run. */
  const testIp = (name: string) => `${runPrefix}:1::${name}`;

  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    url: string,
    who?: keyof typeof users,
    ip = freshIp(),
  ) => {
    const req = request(app.getHttpServer())[method](url).set('x-forwarded-for', ip);
    return who ? req.set('x-test-user', users[who]) : req;
  };
  const base = () => `/api/vehicles/${vehicleId}/reviews`;

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

  async function makeVehicle(status: 'ACTIVE' | 'DRAFT') {
    const id = randomUUID().slice(0, 8);
    const vehicle = await prisma.vehicle.create({
      data: {
        slug: `review-${id}`,
        sellerId: users.seller,
        title: `2021 Mazda CX-5 ${id}`,
        description: 'A test vehicle for reviews.',
        make: 'Mazda',
        model: 'CX-5',
        year: 2021,
        mileageKm: 40000,
        priceCad: 25000,
        bodyType: 'SUV',
        fuelType: 'GASOLINE',
        transmission: 'AUTOMATIC',
        drivetrain: 'AWD',
        condition: 'USED',
        province: 'ON',
        city: 'Toronto',
        status,
      },
    });
    return vehicle.id;
  }

  /** Submits and approves a review straight away, for listing tests. */
  async function approvedReview(rating: number, content: string, vehicle = vehicleId) {
    const created = await call('post', `/api/vehicles/${vehicle}/reviews`)
      .send({ rating, content })
      .expect(201);
    await call('post', `/api/admin/reviews/${created.body.id}/approve`, 'admin')
      .send({})
      .expect(201);
    return created.body.id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret',
              REVIEW_MAX_PER_IP_PER_HOUR: 5,
              REVIEW_MAX_PENDING_PER_IP: 3,
              REVIEW_MAX_REPORTS_PER_IP_PER_HOUR: 3,
              REVIEW_DUPLICATE_WINDOW_HOURS: 72,
              REVIEW_AUTO_FLAG_REPORT_THRESHOLD: 2,
              REVIEW_NOTIFY_AUTHOR: true,
            }),
          ],
        }),
        TestPlatformModule,
        ReviewsModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: TestAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    // As in main.ts, but trusting every hop so each test can be its own address.
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    await app.init();

    users.seller = await makeUser('seller', 'SELLER');
    users.buyer = await makeUser('buyer');
    users.buyer2 = await makeUser('buyer2');
    users.admin = await makeUser('admin', 'ADMIN');
    vehicleId = await makeVehicle('ACTIVE');
    draftVehicleId = await makeVehicle('DRAFT');
  });

  afterAll(async () => {
    await app?.close();
    await closeTestPrisma();
  });

  describe('submitting', () => {
    it('takes an anonymous review and keeps it out of public view until approved', async () => {
      const ip = freshIp();
      const created = await call('post', base(), undefined, ip)
        .send({
          rating: 5,
          content: '  Great   experience with this vehicle.\n\n\n\nVery clean.  ',
        })
        .expect(201);
      expect(created.body.status).toBe('PENDING');
      expect(created.body.message).toMatch(/awaiting approval/);

      const stored = await prisma.vehicleReview.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      expect(stored.content).toBe('Great experience with this vehicle.\n\nVery clean.');
      expect(stored.displayName).toBe('Anonymous');
      expect(stored.userId).toBeNull();
      expect(stored.ipHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.ipHash).not.toContain(ip);

      const page = await call('get', base()).expect(200);
      expect(page.body.reviews.map((r: { id: string }) => r.id)).not.toContain(created.body.id);
    });

    it('takes a signed-in review, one per vehicle, and shows it to its author', async () => {
      const created = await call('post', base(), 'buyer')
        .send({
          rating: 4,
          content: 'Very clean vehicle and good communication.',
          displayName: 'Jordan L.',
        })
        .expect(201);
      const again = await call('post', base(), 'buyer')
        .send({ rating: 3, content: 'Trying to review the same vehicle twice.' })
        .expect(409);
      expect(again.body.message).toBe("You've already submitted a review for this vehicle.");
      const mine = await call('get', `${base()}/mine`, 'buyer').expect(200);
      expect(mine.body.id).toBe(created.body.id);
      expect(mine.body.status).toBe('PENDING');
      expect(mine.body.displayName).toBe('Jordan L.');
    });

    it('validates the rating and the text', async () => {
      for (const rating of [0, 6, 3.5, 'five']) {
        await call('post', base())
          .send({ rating, content: 'A perfectly fine review text.' })
          .expect(400);
      }
      await call('post', base()).send({ content: 'No rating given at all here.' }).expect(400);
      await call('post', base()).send({ rating: 4, content: '      ' }).expect(400);
      await call('post', base()).send({ rating: 4, content: 'Too short' }).expect(400);
      await call('post', base())
        .send({ rating: 4, content: 'x'.repeat(2001) })
        .expect(400);
      await call('post', base())
        .send({ rating: 4, content: 'A fine review here.', displayName: 'http://spam.example' })
        .expect(400);
      // Fields the server decides are refused, not quietly ignored.
      await call('post', base())
        .send({ rating: 4, content: 'A fine review here.', status: 'APPROVED' })
        .expect(400);
      await call('post', base())
        .send({ rating: 4, content: 'A fine review here.', userId: users.admin })
        .expect(400);
    });

    it('answers 404 for a vehicle that does not exist or is not public', async () => {
      await call('post', `/api/vehicles/${randomUUID()}/reviews`)
        .send({ rating: 4, content: 'A fine review here.' })
        .expect(404);
      await call('post', `/api/vehicles/${draftVehicleId}/reviews`)
        .send({ rating: 4, content: 'A fine review here.' })
        .expect(404);
      await call('get', `/api/vehicles/${draftVehicleId}/reviews`).expect(404);
      await call('get', '/api/vehicles/not-a-uuid/reviews').expect(400);
    });

    it('stores tags as nothing and never returns markup', async () => {
      const id = await approvedReview(
        4,
        '<script>alert("x")</script>Solid car, <b>great</b> tires <img src=x onerror=alert(1)> and quiet ride.',
      );
      const stored = await prisma.vehicleReview.findUniqueOrThrow({ where: { id } });
      expect(stored.content).not.toMatch(/<\/?(script|b|img)/i);
      expect(stored.content).toContain('Solid car, great tires');
      const page = await call('get', `${base()}?limit=50`).expect(200);
      expect(JSON.stringify(page.body)).not.toMatch(/<script|onerror=/i);
    });

    it('drops a honeypot submission without telling the bot', async () => {
      const before = await prisma.vehicleReview.count({ where: { vehicleId } });
      const res = await call('post', base())
        .send({
          rating: 5,
          content: 'Buy cheap watches at my store now',
          website: 'https://spam.example',
        })
        .expect(201);
      expect(res.body.id).toBeNull();
      expect(await prisma.vehicleReview.count({ where: { vehicleId } })).toBe(before);
    });

    it('refuses the same text twice and a seller reviewing their own listing', async () => {
      await call('post', base())
        .send({ rating: 2, content: 'Exactly the same words twice over.' })
        .expect(201);
      const dup = await call('post', base())
        .send({ rating: 3, content: 'exactly the SAME words, twice over!' })
        .expect(409);
      expect(dup.body.code).toBe('REVIEW_DUPLICATE');
      await call('post', base(), 'seller')
        .send({ rating: 5, content: 'My own car is the best car.' })
        .expect(403);
    });

    it('limits submissions per address: per hour, and waiting for moderation', async () => {
      const ip = testIp('a');
      const other = await makeVehicle('ACTIVE');
      for (let i = 0; i < 3; i += 1) {
        await call('post', `/api/vehicles/${randomUUID()}/reviews`, undefined, ip)
          .send({ rating: 3, content: `Not a vehicle ${i} at all.` })
          .expect(404);
      }
      await call('post', `/api/vehicles/${other}/reviews`, undefined, ip)
        .send({ rating: 3, content: 'First review from here.' })
        .expect(201);
      await call('post', base(), undefined, ip)
        .send({ rating: 3, content: 'Second review from here.' })
        .expect(201);
      const third = await makeVehicle('ACTIVE');
      await call('post', `/api/vehicles/${third}/reviews`, undefined, ip)
        .send({ rating: 3, content: 'Third review from here.' })
        .expect(201);
      const fourth = await makeVehicle('ACTIVE');
      const limited = await call('post', `/api/vehicles/${fourth}/reviews`, undefined, ip)
        .send({ rating: 3, content: 'Fourth review from here.' })
        .expect(429);
      expect(limited.body.message).toMatch(/waiting for approval/);
    });
  });

  describe('moderation and visibility', () => {
    let vehicle = '';
    beforeAll(async () => {
      vehicle = await makeVehicle('ACTIVE');
    });

    it('lists approved reviews only, and counts only them in the rating', async () => {
      const approved = await approvedReview(5, 'Great experience, accurate description.', vehicle);
      const pending = await call('post', `/api/vehicles/${vehicle}/reviews`)
        .send({ rating: 1, content: 'Pending one should not show.' })
        .expect(201);
      const rejected = await call('post', `/api/vehicles/${vehicle}/reviews`)
        .send({ rating: 1, content: 'Rejected one should not show.' })
        .expect(201);
      await call('post', `/api/admin/reviews/${rejected.body.id}/reject`, 'admin')
        .send({ reason: 'SPAM' })
        .expect(201);
      const hidden = await approvedReview(2, 'Hidden one should not show later.', vehicle);
      await call('post', `/api/admin/reviews/${hidden}/hide`, 'admin').send({}).expect(201);
      const deleted = await approvedReview(1, 'Deleted one should not show later.', vehicle);
      await call('delete', `/api/admin/reviews/${deleted}`, 'admin').send({}).expect(200);

      const page = await call('get', `/api/vehicles/${vehicle}/reviews`).expect(200);
      const ids = page.body.reviews.map((r: { id: string }) => r.id);
      expect(ids).toEqual([approved]);
      expect(ids).not.toContain(pending.body.id);
      expect(page.body.summary).toEqual({
        average: 5,
        total: 1,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
      });
      // Nothing private in the public answer.
      const review = page.body.reviews[0];
      expect(Object.keys(review).sort()).toEqual([
        'content',
        'createdAt',
        'displayName',
        'edited',
        'id',
        'rating',
        'verifiedPurchase',
      ]);
      expect(JSON.stringify(page.body)).not.toMatch(/ipHash|userId|email|status|rejection/i);
    });

    it('allows only the defined transitions, and records each in the history', async () => {
      const created = await call('post', `/api/vehicles/${vehicle}/reviews`)
        .send({ rating: 4, content: 'Going through every state.' })
        .expect(201);
      const id = created.body.id as string;
      await call('post', `/api/admin/reviews/${id}/hide`, 'admin').send({}).expect(409); // pending cannot be hidden
      await call('post', `/api/admin/reviews/${id}/reject`, 'admin').send({}).expect(400); // a reason is required
      await call('post', `/api/admin/reviews/${id}/reject`, 'admin')
        .send({ reason: 'IRRELEVANT', note: 'Off topic' })
        .expect(201);
      await call('post', `/api/admin/reviews/${id}/approve`, 'admin').send({}).expect(201); // rejected → approved
      await call('post', `/api/admin/reviews/${id}/hide`, 'admin')
        .send({ note: 'Checking a complaint' })
        .expect(201);
      await call('post', `/api/admin/reviews/${id}/restore`, 'admin').send({}).expect(201); // hidden → approved
      await call('delete', `/api/admin/reviews/${id}`, 'admin').send({}).expect(200);
      await call('post', `/api/admin/reviews/${id}/restore`, 'admin').send({}).expect(201); // deleted → pending

      const history = await call('get', `/api/admin/reviews/${id}/history`, 'admin').expect(200);
      expect(
        history.body.map(
          (h: { action: string; newStatus: string }) => `${h.action}:${h.newStatus}`,
        ),
      ).toEqual([
        'SUBMITTED:PENDING',
        'REJECTED:REJECTED',
        'APPROVED:APPROVED',
        'HIDDEN:HIDDEN',
        'RESTORED:APPROVED',
        'DELETED:DELETED',
        'RESTORED:PENDING',
      ]);
      expect(history.body[1].reason).toBe('Irrelevant: Off topic');
      expect(history.body[1].actor.id).toBe(users.admin);
      const audit = await prisma.auditLog.count({
        where: { entityType: 'VehicleReview', entityId: id },
      });
      expect(audit).toBe(6);
    });

    it('keeps moderation to administrators with the review permissions', async () => {
      const created = await call('post', `/api/vehicles/${vehicle}/reviews`)
        .send({ rating: 4, content: 'Who may approve this one?' })
        .expect(201);
      const id = created.body.id as string;
      await call('post', `/api/admin/reviews/${id}/approve`, 'buyer').send({}).expect(403);
      await call('post', `/api/admin/reviews/${id}/approve`, 'seller').send({}).expect(403);
      await call('get', '/api/admin/reviews', 'buyer').expect(403);
      await call('get', `/api/admin/reviews/${id}/history`, 'buyer').expect(403);
      await call('post', `/api/admin/reviews/${id}/approve`).send({}).expect(403);
      const list = await call('get', '/api/admin/reviews?view=PENDING', 'admin').expect(200);
      expect(list.body.items.some((r: { id: string }) => r.id === id)).toBe(true);
    });

    it('tells a signed-in author when their review is approved', async () => {
      const v = await makeVehicle('ACTIVE');
      const created = await call('post', `/api/vehicles/${v}/reviews`, 'buyer2')
        .send({ rating: 5, content: 'Notify me when this is live.' })
        .expect(201);
      await call('post', `/api/admin/reviews/${created.body.id}/approve`, 'admin')
        .send({})
        .expect(201);
      const note = await prisma.notification.findFirst({
        where: { userId: users.buyer2, type: 'REVIEW_APPROVED' },
      });
      expect(note?.link).toContain('#reviews');
    });

    it('lets the author edit (back to moderation) and withdraw their review', async () => {
      const v = await makeVehicle('ACTIVE');
      const created = await call('post', `/api/vehicles/${v}/reviews`, 'buyer')
        .send({ rating: 3, content: 'First version of my review.' })
        .expect(201);
      const id = created.body.id as string;
      await call('post', `/api/admin/reviews/${id}/approve`, 'admin').send({}).expect(201);
      await call('patch', `/api/vehicles/${v}/reviews/${id}`, 'buyer2')
        .send({ rating: 1, content: 'Someone else editing it.' })
        .expect(404);
      await call('patch', `/api/vehicles/${v}/reviews/${id}`, 'buyer')
        .send({ rating: 4, content: 'Second, better version of my review.' })
        .expect(200);
      const after = await prisma.vehicleReview.findUniqueOrThrow({ where: { id } });
      expect(after.status).toBe('PENDING');
      expect(after.rating).toBe(4);
      expect((await call('get', `/api/vehicles/${v}/reviews`).expect(200)).body.summary.total).toBe(
        0,
      );
      await call('delete', `/api/vehicles/${v}/reviews/${id}`, 'buyer').expect(204);
      expect((await prisma.vehicleReview.findUniqueOrThrow({ where: { id } })).status).toBe(
        'DELETED',
      );
      // Withdrawn, the author may write again.
      await call('post', `/api/vehicles/${v}/reviews`, 'buyer')
        .send({ rating: 4, content: 'A fresh review after withdrawing.' })
        .expect(201);
    });

    it('shows "Verified purchase" only when a posted sale proves it', async () => {
      const v = await makeVehicle('ACTIVE');
      const dealer = await prisma.dealer.create({
        data: {
          ownerId: users.seller,
          name: `Review Motors ${suffix}`,
          slug: `review-motors-${suffix}`,
          province: 'ON',
        },
      });
      const customer = await prisma.customer.create({
        data: { dealerId: dealer.id, name: 'Buyer Test', userId: users.buyer2 },
      });
      await prisma.vehicleSale.create({
        data: {
          dealerId: dealer.id,
          number: 1,
          vehicleId: v,
          customerId: customer.id,
          saleDate: new Date(),
          salePrice: 25000,
          status: 'POSTED',
        },
      });
      const verified = await call('post', `/api/vehicles/${v}/reviews`, 'buyer2')
        .send({ rating: 5, content: 'I bought this one and love it.' })
        .expect(201);
      const unverified = await call('post', `/api/vehicles/${v}/reviews`, 'buyer')
        .send({ rating: 4, content: 'Test drove it, did not buy.' })
        .expect(201);
      for (const id of [verified.body.id, unverified.body.id]) {
        await call('post', `/api/admin/reviews/${id}/approve`, 'admin').send({}).expect(201);
      }
      const page = await call('get', `/api/vehicles/${v}/reviews`).expect(200);
      const byId = Object.fromEntries(
        page.body.reviews.map((r: { id: string; verifiedPurchase: boolean }) => [
          r.id,
          r.verifiedPurchase,
        ]),
      );
      expect(byId[verified.body.id]).toBe(true);
      expect(byId[unverified.body.id]).toBe(false);
    });
  });

  describe('pagination, sorting and the summary', () => {
    let vehicle = '';
    const ratings = [5, 3, 4, 1, 5, 2, 4];
    beforeAll(async () => {
      vehicle = await makeVehicle('ACTIVE');
      for (const [index, rating] of ratings.entries()) {
        await approvedReview(rating, `Review number ${index} of this vehicle.`, vehicle);
      }
    });

    it('pages with a cursor, without repeats or gaps', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const url: string = `/api/vehicles/${vehicle}/reviews?limit=3${cursor ? `&cursor=${cursor}` : ''}`;
        const res: request.Response = await call('get', url).expect(200);
        if (pages === 0) expect(res.body.summary.total).toBe(ratings.length);
        else expect(res.body.summary).toBeUndefined();
        seen.push(...res.body.reviews.map((r: { id: string }) => r.id));
        cursor = res.body.pagination.nextCursor;
        expect(res.body.pagination.hasMore).toBe(cursor !== null);
        pages += 1;
      } while (cursor);
      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(ratings.length);
      await call('get', `/api/vehicles/${vehicle}/reviews?cursor=garbage`).expect(400);
    });

    it('sorts by most recent, highest and lowest rated', async () => {
      const recent = await call('get', `/api/vehicles/${vehicle}/reviews?limit=50`).expect(200);
      const times = recent.body.reviews.map((r: { createdAt: string }) => r.createdAt);
      expect([...times].sort().reverse()).toEqual(times);
      for (const [sort, expected] of [
        ['HIGHEST', [...ratings].sort((a, b) => b - a)],
        ['LOWEST', [...ratings].sort((a, b) => a - b)],
      ] as const) {
        const collected: number[] = [];
        let cursor: string | null = null;
        do {
          const res: request.Response = await call(
            'get',
            `/api/vehicles/${vehicle}/reviews?sort=${sort}&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
          ).expect(200);
          collected.push(...res.body.reviews.map((r: { rating: number }) => r.rating));
          cursor = res.body.pagination.nextCursor;
        } while (cursor);
        expect(collected).toEqual(expected);
      }
    });

    it('summarises approved ratings', async () => {
      const res = await call('get', `/api/vehicles/${vehicle}/reviews`).expect(200);
      expect(res.body.summary).toEqual({
        average: Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10,
        total: 7,
        distribution: { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2 },
      });
    });
  });

  describe('reporting', () => {
    let vehicle = '';
    let reviewId = '';
    beforeAll(async () => {
      vehicle = await makeVehicle('ACTIVE');
      reviewId = await approvedReview(1, 'This review will be reported.', vehicle);
    });

    it('counts reports, refuses repeats, and flags at the threshold without taking it down', async () => {
      const url = `/api/vehicles/${vehicle}/reviews/${reviewId}/report`;
      const first = await call('post', url, 'buyer').send({ reason: 'SPAM' }).expect(201);
      expect(first.body.message).toBe("Thanks. We've received your report and will review it.");
      await call('post', url, 'buyer').send({ reason: 'OFFENSIVE' }).expect(409);
      const anonIp = testIp('b');
      await call('post', url, undefined, anonIp)
        .send({ reason: 'FAKE_REVIEW', details: 'Never owned it' })
        .expect(201);
      await call('post', url, undefined, anonIp).send({ reason: 'FAKE_REVIEW' }).expect(409);
      await call('post', url).send({ reason: 'NOT_A_REASON' }).expect(400);

      const review = await prisma.vehicleReview.findUniqueOrThrow({ where: { id: reviewId } });
      expect(review.reportCount).toBe(2);
      expect(review.openReportCount).toBe(2);
      expect(review.flaggedAt).not.toBeNull();
      expect(review.status).toBe('APPROVED');

      const reported = await call('get', '/api/admin/reviews?view=REPORTED', 'admin').expect(200);
      expect(reported.body.items.some((r: { id: string }) => r.id === reviewId)).toBe(true);
      await call('post', `/api/admin/reviews/${reviewId}/resolve-reports`, 'admin')
        .send({})
        .expect(201);
      const resolved = await prisma.vehicleReview.findUniqueOrThrow({ where: { id: reviewId } });
      expect(resolved.openReportCount).toBe(0);
      expect(resolved.flaggedAt).toBeNull();
    });

    it('limits reports per address and refuses reports on reviews that are not public', async () => {
      const ip = testIp('c');
      const v = await makeVehicle('ACTIVE');
      const targets = [];
      for (let i = 0; i < 4; i += 1)
        targets.push(await approvedReview(3, `Report target number ${i} here.`, v));
      for (let i = 0; i < 3; i += 1) {
        await call('post', `/api/vehicles/${v}/reviews/${targets[i]}/report`, undefined, ip)
          .send({ reason: 'SPAM' })
          .expect(201);
      }
      await call('post', `/api/vehicles/${v}/reviews/${targets[3]}/report`, undefined, ip)
        .send({ reason: 'SPAM' })
        .expect(429);
      const pending = await call('post', `/api/vehicles/${v}/reviews`)
        .send({ rating: 3, content: 'Pending, not reportable.' })
        .expect(201);
      await call('post', `/api/vehicles/${v}/reviews/${pending.body.id}/report`)
        .send({ reason: 'SPAM' })
        .expect(404);
      // A review id from another vehicle is not found under this one.
      await call('post', `/api/vehicles/${vehicle}/reviews/${targets[0]}/report`)
        .send({ reason: 'SPAM' })
        .expect(404);
    });
  });

  it('bulk-moderates and reports metrics', async () => {
    const v = await makeVehicle('ACTIVE');
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await call('post', `/api/vehicles/${v}/reviews`)
        .send({ rating: 4, content: `Bulk candidate number ${i}.` })
        .expect(201);
      ids.push(res.body.id);
    }
    await call('post', '/api/admin/reviews/bulk', 'admin')
      .send({ ids, action: 'REJECT' })
      .expect(400);
    const result = await call('post', '/api/admin/reviews/bulk', 'admin')
      .send({ ids: [...ids, randomUUID()], action: 'APPROVE' })
      .expect(201);
    expect(result.body.succeeded).toBe(3);
    expect(result.body.failed).toBe(1);
    const metrics = await call('get', '/api/admin/reviews/metrics', 'admin').expect(200);
    expect(metrics.body.approved).toBeGreaterThanOrEqual(3);
    expect(metrics.body.last7Days).toBeGreaterThanOrEqual(3);
  });
});
