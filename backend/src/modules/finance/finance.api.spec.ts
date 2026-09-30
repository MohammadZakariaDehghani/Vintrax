import { randomUUID } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Injectable,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { UserRole } from '@vintrax/shared';
import request from 'supertest';
import type { AuthUser } from '../../common/auth/auth-user';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

/**
 * The finance API end to end: the real controller, validation, permissions
 * guard and service, over an in-memory stand-in for the Prisma calls the
 * service makes. The stand-in applies the same filters Postgres would, so a
 * query that forgot the seller would hand another dealer's applicants over
 * here too.
 */

type Where = Record<string, unknown>;

interface VehicleRow {
  id: string;
  slug: string;
  title: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  priceCad: number;
  stockNumber: string | null;
  vin: string | null;
  sellerId: string;
  status: string;
}

type ApplicationRow = Record<string, unknown> & {
  id: string;
  vehicleId: string;
  sellerId: string;
  applicantId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') {
      return (expected as Where[]).some((clause) => matches(row, clause));
    }
    const actual = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const filter = expected as { in?: unknown[]; contains?: string };
      if (filter.in) return filter.in.includes(actual);
      if (filter.contains !== undefined) {
        return String(actual ?? '')
          .toLowerCase()
          .includes(filter.contains.toLowerCase());
      }
      return true; // relation filters (vehicle: {...}) are not needed by these tests
    }
    return actual === expected;
  });
}

class FakeDatabase {
  vehicles = new Map<string, VehicleRow>();
  applications = new Map<string, ApplicationRow>();
  settings = new Map<string, { acceptApplications: boolean; notificationEmail: string | null }>();
  users = new Map<string, { email: string }>();

  private withVehicle(row: ApplicationRow) {
    const vehicle = this.vehicles.get(row.vehicleId)!;
    return { ...row, vehicle: { ...vehicle, images: [] } };
  }

  vehicle = {
    findFirst: async ({ where }: { where: Where }) =>
      [...this.vehicles.values()].find((row) => matches(row as never, where)) ?? null,
  };

  user = {
    findUnique: async ({ where }: { where: { id: string } }) => this.users.get(where.id) ?? null,
  };

  sellerFinanceSettings = {
    findUnique: async ({ where }: { where: { sellerId: string } }) =>
      this.settings.get(where.sellerId) ?? null,
    upsert: async ({
      where,
      create,
    }: {
      where: { sellerId: string };
      create: { acceptApplications: boolean; notificationEmail: string | null };
    }) => {
      this.settings.set(where.sellerId, {
        acceptApplications: create.acceptApplications,
        notificationEmail: create.notificationEmail,
      });
    },
  };

  financeApplication = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        ...data,
        id: randomUUID(),
        status: 'NEW',
        dealerNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as ApplicationRow;
      this.applications.set(row.id, row);
      return { id: row.id };
    },
    findFirst: async ({ where }: { where: Where }) => {
      const row = [...this.applications.values()].find((r) => matches(r, where));
      return row ? this.withVehicle(row) : null;
    },
    findMany: async ({ where, skip, take }: { where: Where; skip: number; take: number }) =>
      [...this.applications.values()]
        .filter((r) => matches(r, where))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(skip, skip + take)
        .map((r) => this.withVehicle(r)),
    count: async ({ where }: { where: Where }) =>
      [...this.applications.values()].filter((r) => matches(r, where)).length,
    groupBy: async ({ where }: { where: Where }) => {
      const counts = new Map<string, number>();
      for (const r of this.applications.values()) {
        if (matches(r, where)) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
      }
      return [...counts].map(([status, n]) => ({ status, _count: { _all: n } }));
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = { ...this.applications.get(where.id)!, ...data, updatedAt: new Date() };
      this.applications.set(where.id, row as ApplicationRow);
      return this.withVehicle(row as ApplicationRow);
    },
    delete: async ({ where }: { where: { id: string } }) => {
      this.applications.delete(where.id);
    },
  };
}

function user(role: UserRole): AuthUser {
  return {
    id: randomUUID(),
    email: `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`,
    firstName: 'Test',
    lastName: 'User',
    role,
    status: 'ACTIVE',
    emailVerified: true,
    dealerId: null,
  };
}

const DEALER_A = user('DEALER');
const DEALER_B = user('DEALER');
const BUYER = user('BUYER');
const OTHER_BUYER = user('BUYER');

@Injectable()
class TestIdentityGuard implements CanActivate {
  static users = new Map<string, AuthUser>();
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: AuthUser }>();
    const caller = TestIdentityGuard.users.get(req.headers['x-test-user'] ?? '');
    if (caller) req.user = caller;
    return true;
  }
}
for (const caller of [DEALER_A, DEALER_B, BUYER, OTHER_BUYER]) {
  TestIdentityGuard.users.set(caller.id, caller);
}

const application = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Mohammad',
  lastName: 'Dehghani',
  email: 'buyer@example.test',
  phone: '416 555 0134',
  dateOfBirth: '1990-05-02',
  postalCode: 'V5L 1A1',
  creditRange: 'GOOD',
  grossIncomeCad: 85000,
  incomeFrequency: 'ANNUALLY',
  employmentStatus: 'EMPLOYED',
  employerName: 'North Shore Builders',
  jobTitle: 'Site lead',
  employmentMonths: 38,
  housingStatus: 'RENT',
  monthlyHousingCad: 1900,
  addressMonths: 26,
  hasTradeIn: true,
  tradeInYear: 2014,
  tradeInMake: 'Ford',
  tradeInModel: 'Focus',
  tradeInMileageKm: 129891,
  tradeInOwedCad: 0,
  downPaymentCad: 2000,
  termMonths: 72,
  preferredContact: 'PHONE',
  preferredVisitDate: null,
  comments: 'Weekday evenings are best.',
  consent: true,
  ...overrides,
});

describe('finance application API', () => {
  let app: INestApplication;
  let db: FakeDatabase;
  let mail: { sendFinanceApplicationNotice: jest.Mock };
  let notifications: { notify: jest.Mock };
  let focus: VehicleRow;
  let pending: VehicleRow;

  const as = (caller: AuthUser) => ({ 'x-test-user': caller.id });

  beforeAll(async () => {
    db = new FakeDatabase();
    mail = { sendFinanceApplicationNotice: jest.fn(async () => undefined) };
    notifications = { notify: jest.fn(async () => undefined) };
    const service = new FinanceService(
      db as never,
      mail as never,
      { record: async () => undefined } as never,
      notifications as never,
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [FinanceController],
      providers: [
        { provide: FinanceService, useValue: service },
        { provide: APP_GUARD, useClass: TestIdentityGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db.users.set(DEALER_A.id, { email: DEALER_A.email });
    const base = {
      year: 2016,
      make: 'Ford',
      model: 'Focus',
      trim: 'SE',
      priceCad: 6980,
      stockNumber: 'F-16',
      vin: null,
      sellerId: DEALER_A.id,
    };
    focus = {
      ...base,
      id: randomUUID(),
      slug: 'focus',
      title: '2016 Ford Focus SE',
      status: 'ACTIVE',
    };
    pending = {
      ...base,
      id: randomUUID(),
      slug: 'p',
      title: 'Pending car',
      status: 'PENDING_REVIEW',
    };
    db.vehicles.set(focus.id, focus);
    db.vehicles.set(pending.id, pending);
  });

  afterAll(async () => {
    await app.close();
  });

  const apply = (vehicleId: string, caller: AuthUser, body = application()) =>
    request(app.getHttpServer())
      .post(`/vehicles/${vehicleId}/finance-applications`)
      .set(as(caller))
      .send(body);

  describe('a buyer applying', () => {
    it('is offered the form on a live listing, not on their own', async () => {
      const buyerView = await request(app.getHttpServer())
        .get(`/vehicles/${focus.id}/finance-options`)
        .set(as(BUYER))
        .expect(200);
      expect(buyerView.body).toEqual({ acceptsApplications: true, openApplicationId: null });

      const ownView = await request(app.getHttpServer())
        .get(`/vehicles/${focus.id}/finance-options`)
        .set(as(DEALER_A))
        .expect(200);
      expect(ownView.body.acceptsApplications).toBe(false);
    });

    it('refuses an incomplete application, with reasons', async () => {
      const response = await apply(
        focus.id,
        BUYER,
        application({ consent: false, dateOfBirth: '2012-01-01' }),
      ).expect(400);
      expect(JSON.stringify(response.body)).toMatch(/at least 18/);
    });

    it('refuses fields a buyer must not set, such as the seller or status', async () => {
      await apply(focus.id, BUYER, { ...application(), sellerId: DEALER_B.id } as never).expect(
        400,
      );
      await apply(focus.id, BUYER, { ...application(), status: 'APPROVED' } as never).expect(400);
    });

    it('sends it to the seller, and tells them without the personal details', async () => {
      const response = await apply(focus.id, BUYER).expect(201);
      const stored = db.applications.get(response.body.id)!;

      expect(stored.sellerId).toBe(DEALER_A.id);
      expect(stored.applicantId).toBe(BUYER.id);
      expect(stored).not.toHaveProperty('consent');

      expect(mail.sendFinanceApplicationNotice).toHaveBeenCalledTimes(1);
      const [to, details] = mail.sendFinanceApplicationNotice.mock.calls[0]!;
      expect(to).toBe(DEALER_A.email);
      expect(JSON.stringify(details)).not.toMatch(/1990-05-02|85000/);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: DEALER_A.id }),
      );
    });

    it('does not take a second open application for the same car', async () => {
      await apply(focus.id, BUYER).expect(409);
      const view = await request(app.getHttpServer())
        .get(`/vehicles/${focus.id}/finance-options`)
        .set(as(BUYER))
        .expect(200);
      expect(view.body.openApplicationId).toEqual(expect.any(String));
    });

    it('cannot apply for a listing that is not live, or for their own', async () => {
      await apply(pending.id, OTHER_BUYER).expect(404);
      await apply(focus.id, DEALER_A).expect(400);
    });
  });

  describe('the seller', () => {
    it('sees applications for their own listings only', async () => {
      const mine = await request(app.getHttpServer())
        .get('/dealer/finance-applications')
        .set(as(DEALER_A))
        .expect(200);
      expect(mine.body.total).toBe(1);
      expect(mine.body.counts.NEW).toBe(1);
      expect(mine.body.items[0]).toMatchObject({
        firstName: 'Mohammad',
        annualIncomeCad: 85000,
        vehicle: { title: '2016 Ford Focus SE' },
      });
      // The list is a summary: the date of birth is only in the detail.
      expect(mine.body.items[0]).not.toHaveProperty('dateOfBirth');

      const theirs = await request(app.getHttpServer())
        .get('/dealer/finance-applications')
        .set(as(DEALER_B))
        .expect(200);
      expect(theirs.body.total).toBe(0);
    });

    it('opens, updates and deletes only their own, and another dealer gets not-found', async () => {
      const id = [...db.applications.keys()][0]!;

      const detail = await request(app.getHttpServer())
        .get(`/dealer/finance-applications/${id}`)
        .set(as(DEALER_A))
        .expect(200);
      expect(detail.body).toMatchObject({ dateOfBirth: '1990-05-02', tradeInMake: 'Ford' });

      await request(app.getHttpServer())
        .get(`/dealer/finance-applications/${id}`)
        .set(as(DEALER_B))
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/dealer/finance-applications/${id}`)
        .set(as(DEALER_B))
        .send({ status: 'APPROVED' })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/dealer/finance-applications/${id}`)
        .set(as(DEALER_B))
        .expect(404);

      const updated = await request(app.getHttpServer())
        .patch(`/dealer/finance-applications/${id}`)
        .set(as(DEALER_A))
        .send({ status: 'CONTACTED', dealerNotes: 'Called; booked for Saturday.' })
        .expect(200);
      expect(updated.body).toMatchObject({
        status: 'CONTACTED',
        dealerNotes: 'Called; booked for Saturday.',
      });

      await request(app.getHttpServer())
        .delete(`/dealer/finance-applications/${id}`)
        .set(as(DEALER_A))
        .expect(204);
      expect(db.applications.has(id)).toBe(false);
    });

    it('is the only kind of account that reaches the portal routes', async () => {
      await request(app.getHttpServer())
        .get('/dealer/finance-applications')
        .set(as(BUYER))
        .expect(403);
      await request(app.getHttpServer()).get('/dealer/finance-settings').expect(403);
    });

    it('chooses where applications are emailed, and can stop taking them', async () => {
      const initial = await request(app.getHttpServer())
        .get('/dealer/finance-settings')
        .set(as(DEALER_A))
        .expect(200);
      expect(initial.body).toEqual({
        acceptApplications: true,
        notificationEmail: null,
        effectiveEmail: DEALER_A.email,
      });

      await request(app.getHttpServer())
        .put('/dealer/finance-settings')
        .set(as(DEALER_A))
        .send({ acceptApplications: true, notificationEmail: 'not an email' })
        .expect(400);

      const changed = await request(app.getHttpServer())
        .put('/dealer/finance-settings')
        .set(as(DEALER_A))
        .send({ acceptApplications: true, notificationEmail: 'Finance@NorthShore.test' })
        .expect(200);
      expect(changed.body.effectiveEmail).toBe('finance@northshore.test');

      mail.sendFinanceApplicationNotice.mockClear();
      await apply(focus.id, OTHER_BUYER).expect(201);
      expect(mail.sendFinanceApplicationNotice.mock.calls[0]![0]).toBe('finance@northshore.test');

      await request(app.getHttpServer())
        .put('/dealer/finance-settings')
        .set(as(DEALER_A))
        .send({ acceptApplications: false, notificationEmail: null })
        .expect(200);
      const closed = await request(app.getHttpServer())
        .get(`/vehicles/${focus.id}/finance-options`)
        .set(as(BUYER))
        .expect(200);
      expect(closed.body.acceptsApplications).toBe(false);
      await apply(focus.id, BUYER).expect(403);
    });
  });
});
