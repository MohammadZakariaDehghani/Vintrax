import { randomUUID } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Injectable,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { ListingStatus, UserRole } from '@vintrax/shared';
import request from 'supertest';
import type { AuthUser } from '../../common/auth/auth-user';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { VehicleCostsController } from './vehicle-costs.controller';
import { VehicleCostsService } from './vehicle-costs.service';

/**
 * The cost API end to end: the real controller, validation, permissions guard
 * and service, over an in-memory stand-in for the handful of Prisma calls the
 * service makes. The stand-in applies the same filters Postgres would, so a
 * query that forgot the seller would return another dealer's rows here too.
 */

interface VehicleRow {
  id: string;
  sellerId: string;
  title: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  vin: string | null;
  stockNumber: string | null;
  priceCad: number;
  status: ListingStatus;
  updatedAt: Date;
}

interface CostRow {
  id: string;
  vehicleId: string;
  category: string;
  description: string | null;
  amountCents: number;
  incurredOn: Date;
  vendor: string | null;
  reference: string | null;
  notes: string | null;
  recordedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type Where = Record<string, unknown>;

class FakeDatabase {
  vehicles = new Map<string, VehicleRow>();
  costs = new Map<string, CostRow>();

  private sellerOf(vehicleId: string) {
    return this.vehicles.get(vehicleId)?.sellerId;
  }

  private costMatches(cost: CostRow, where: Where): boolean {
    if (where['id'] !== undefined && where['id'] !== cost.id) return false;
    const vehicleFilter = where['vehicle'] as { sellerId?: string } | undefined;
    if (vehicleFilter?.sellerId && this.sellerOf(cost.vehicleId) !== vehicleFilter.sellerId) {
      return false;
    }
    const vehicleId = where['vehicleId'] as { in?: string[] } | string | undefined;
    if (typeof vehicleId === 'string' && vehicleId !== cost.vehicleId) return false;
    if (typeof vehicleId === 'object' && vehicleId.in && !vehicleId.in.includes(cost.vehicleId)) {
      return false;
    }
    return true;
  }

  private vehicleMatches(vehicle: VehicleRow, where: Where): boolean {
    if (where['id'] !== undefined && where['id'] !== vehicle.id) return false;
    if (where['sellerId'] !== undefined && where['sellerId'] !== vehicle.sellerId) return false;
    const status = where['status'] as { in?: string[] } | undefined;
    if (status?.in && !status.in.includes(vehicle.status)) return false;
    return true;
  }

  vehicle = {
    findFirst: async ({ where }: { where: Where }) => {
      const vehicle = [...this.vehicles.values()].find((row) => this.vehicleMatches(row, where));
      if (!vehicle) return null;
      const costs = [...this.costs.values()]
        .filter((cost) => cost.vehicleId === vehicle.id)
        .sort((a, b) => a.incurredOn.getTime() - b.incurredOn.getTime());
      return { ...vehicle, images: [], costs };
    },
    findMany: async ({ where }: { where: Where }) =>
      [...this.vehicles.values()].filter((row) => this.vehicleMatches(row, where)),
  };

  vehicleCost = {
    create: async ({ data }: { data: Omit<CostRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
      const row: CostRow = {
        ...data,
        id: randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.costs.set(row.id, row);
      return row;
    },
    findFirst: async ({ where }: { where: Where }) =>
      [...this.costs.values()].find((cost) => this.costMatches(cost, where)) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<CostRow> }) => {
      const current = this.costs.get(where.id)!;
      const next = { ...current, ...data, updatedAt: new Date() };
      this.costs.set(where.id, next);
      return next;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      this.costs.delete(where.id);
    },
    groupBy: async ({ where }: { where: Where }) => {
      const groups = new Map<
        string,
        { vehicleId: string; category: string; sum: number; count: number; max: Date }
      >();
      for (const cost of this.costs.values()) {
        if (!this.costMatches(cost, where)) continue;
        const key = `${cost.vehicleId}:${cost.category}`;
        const group = groups.get(key) ?? {
          vehicleId: cost.vehicleId,
          category: cost.category,
          sum: 0,
          count: 0,
          max: cost.updatedAt,
        };
        group.sum += cost.amountCents;
        group.count += 1;
        if (cost.updatedAt > group.max) group.max = cost.updatedAt;
        groups.set(key, group);
      }
      return [...groups.values()].map((group) => ({
        vehicleId: group.vehicleId,
        category: group.category,
        _sum: { amountCents: group.sum },
        _count: { _all: group.count },
        _max: { updatedAt: group.max },
      }));
    },
  };
}

function user(role: UserRole): AuthUser {
  return {
    id: randomUUID(),
    email: `${role.toLowerCase()}-${randomUUID()}@example.test`,
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
for (const caller of [DEALER_A, DEALER_B, BUYER]) TestIdentityGuard.users.set(caller.id, caller);

function vehicle(sellerId: string, overrides: Partial<VehicleRow> = {}): VehicleRow {
  return {
    id: randomUUID(),
    sellerId,
    title: '2020 Honda Civic',
    year: 2020,
    make: 'Honda',
    model: 'Civic',
    trim: null,
    vin: '2HGFC2F59LH123456',
    stockNumber: 'C-1',
    priceCad: 21995,
    status: 'ACTIVE',
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('vehicle cost API', () => {
  let app: INestApplication;
  let db: FakeDatabase;
  let audit: { record: jest.Mock };
  let civic: VehicleRow;
  let otherDealersCar: VehicleRow;

  const as = (caller: AuthUser) => ({ 'x-test-user': caller.id });
  const cost = (overrides: Record<string, unknown> = {}) => ({
    category: 'PURCHASE',
    amountCents: 1_500_000,
    incurredOn: '2026-09-01',
    ...overrides,
  });

  beforeAll(async () => {
    db = new FakeDatabase();
    audit = { record: jest.fn(async () => undefined) };
    const service = new VehicleCostsService(db as never, audit as never);

    const moduleRef = await Test.createTestingModule({
      controllers: [VehicleCostsController],
      providers: [
        { provide: VehicleCostsService, useValue: service },
        { provide: APP_GUARD, useClass: TestIdentityGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    db.vehicles.clear();
    db.costs.clear();
    audit.record.mockClear();
    civic = vehicle(DEALER_A.id);
    otherDealersCar = vehicle(DEALER_B.id, { title: '2019 Ford F-150', priceCad: 40000 });
    db.vehicles.set(civic.id, civic);
    db.vehicles.set(otherDealersCar.id, otherDealersCar);
  });

  afterAll(async () => {
    await app.close();
  });

  const add = (caller: AuthUser, vehicleId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/dealer/inventory/${vehicleId}/costs`)
      .set(as(caller))
      .send(body);

  describe('a dealer on their own vehicle', () => {
    it('adds a cost, recording who entered it', async () => {
      const response = await add(DEALER_A, civic.id, cost({ vendor: 'Manheim' })).expect(201);

      expect(response.body).toMatchObject({
        vehicleId: civic.id,
        category: 'PURCHASE',
        amountCents: 1_500_000,
        incurredOn: '2026-09-01',
        vendor: 'Manheim',
      });
      expect(db.costs.get(response.body.id)?.recordedById).toBe(DEALER_A.id);
    });

    it('edits a cost', async () => {
      const created = await add(DEALER_A, civic.id, cost()).expect(201);

      const response = await request(app.getHttpServer())
        .patch(`/dealer/costs/${created.body.id}`)
        .set(as(DEALER_A))
        .send({ amountCents: 1_450_000, notes: 'Renegotiated' })
        .expect(200);

      expect(response.body).toMatchObject({ amountCents: 1_450_000, notes: 'Renegotiated' });
    });

    it('deletes a cost', async () => {
      const created = await add(DEALER_A, civic.id, cost()).expect(201);

      await request(app.getHttpServer())
        .delete(`/dealer/costs/${created.body.id}`)
        .set(as(DEALER_A))
        .expect(204);

      expect(db.costs.has(created.body.id)).toBe(false);
    });

    it('totals the costs and works out the gross margin (the Civic example)', async () => {
      // $15,000 + $750 + $450 + $900 + $200 + $350 = $17,650 against $21,995.
      for (const [category, amountCents] of [
        ['PURCHASE', 1_500_000],
        ['AUCTION_FEE', 75_000],
        ['TRANSPORTATION', 45_000],
        ['MECHANICAL_REPAIR', 90_000],
        ['DETAILING', 20_000],
        ['PARTS', 35_000],
      ] as const) {
        await add(DEALER_A, civic.id, cost({ category, amountCents })).expect(201);
      }

      const response = await request(app.getHttpServer())
        .get(`/dealer/inventory/${civic.id}/costs`)
        .set(as(DEALER_A))
        .expect(200);

      expect(response.body.entries).toHaveLength(6);
      expect(response.body.totals).toEqual({
        purchaseCents: 1_500_000,
        additionalCents: 265_000,
        repairCents: 125_000,
        otherCents: 140_000,
        totalCents: 1_765_000,
        grossMarginCents: 434_500,
      });
    });

    it('summarises only their own inventory on the overview', async () => {
      await add(DEALER_A, civic.id, cost()).expect(201);
      await add(DEALER_B, otherDealersCar.id, cost({ amountCents: 3_000_000 })).expect(201);

      const response = await request(app.getHttpServer())
        .get('/dealer/costs?scope=ALL')
        .set(as(DEALER_A))
        .expect(200);

      expect(response.body.summary).toMatchObject({
        vehicleCount: 1,
        costedVehicleCount: 1,
        totalCostCents: 1_500_000,
        averageCostCents: 1_500_000,
        averageGrossMarginCents: 2_199_500 - 1_500_000,
      });
      expect(response.body.items.map((row: { vehicleId: string }) => row.vehicleId)).toEqual([
        civic.id,
      ]);
    });
  });

  describe("another dealer's vehicle and costs", () => {
    let theirCostId: string;

    beforeEach(async () => {
      const created = await add(DEALER_B, otherDealersCar.id, cost()).expect(201);
      theirCostId = created.body.id;
    });

    it('cannot be read', async () => {
      await request(app.getHttpServer())
        .get(`/dealer/inventory/${otherDealersCar.id}/costs`)
        .set(as(DEALER_A))
        .expect(404);
    });

    it('cannot be added to', async () => {
      await add(DEALER_A, otherDealersCar.id, cost()).expect(404);
      expect(
        [...db.costs.values()].filter((row) => row.vehicleId === otherDealersCar.id),
      ).toHaveLength(1);
    });

    it('cannot be edited', async () => {
      await request(app.getHttpServer())
        .patch(`/dealer/costs/${theirCostId}`)
        .set(as(DEALER_A))
        .send({ amountCents: 1 })
        .expect(404);
      expect(db.costs.get(theirCostId)?.amountCents).toBe(1_500_000);
    });

    it('cannot be deleted', async () => {
      await request(app.getHttpServer())
        .delete(`/dealer/costs/${theirCostId}`)
        .set(as(DEALER_A))
        .expect(404);
      expect(db.costs.has(theirCostId)).toBe(true);
    });

    it('answers exactly as a cost that does not exist, so it confirms nothing', async () => {
      const theirs = await request(app.getHttpServer())
        .delete(`/dealer/costs/${theirCostId}`)
        .set(as(DEALER_A));
      const missing = await request(app.getHttpServer())
        .delete(`/dealer/costs/${randomUUID()}`)
        .set(as(DEALER_A));
      expect(theirs.status).toBe(missing.status);
      expect(theirs.body.message).toBe(missing.body.message);
    });
  });

  describe('input', () => {
    it('refuses a vehicle or owner smuggled into the body', async () => {
      await add(DEALER_A, civic.id, cost({ vehicleId: otherDealersCar.id })).expect(400);
      await add(DEALER_A, civic.id, cost({ sellerId: DEALER_B.id })).expect(400);

      const created = await add(DEALER_A, civic.id, cost()).expect(201);
      await request(app.getHttpServer())
        .patch(`/dealer/costs/${created.body.id}`)
        .set(as(DEALER_A))
        .send({ vehicleId: otherDealersCar.id })
        .expect(400);
      expect(db.costs.get(created.body.id)?.vehicleId).toBe(civic.id);
    });

    it('refuses zero, negative and fractional-cent amounts', async () => {
      await add(DEALER_A, civic.id, cost({ amountCents: 0 })).expect(400);
      await add(DEALER_A, civic.id, cost({ amountCents: -100 })).expect(400);
      await add(DEALER_A, civic.id, cost({ amountCents: 10.5 })).expect(400);
    });

    it('refuses an unknown category and an impossible date', async () => {
      await add(DEALER_A, civic.id, cost({ category: 'LUNCH' })).expect(400);
      await add(DEALER_A, civic.id, cost({ incurredOn: '2026-02-30' })).expect(400);
    });

    it('refuses a malformed id before touching the database', async () => {
      await request(app.getHttpServer())
        .get('/dealer/inventory/not-a-uuid/costs')
        .set(as(DEALER_A))
        .expect(400);
    });
  });

  describe('who may call it', () => {
    it('refuses a signed-out caller', async () => {
      await request(app.getHttpServer()).get('/dealer/costs').expect(403);
      await add({ id: 'nobody' } as AuthUser, civic.id, cost()).expect(403);
    });

    it('refuses a buyer', async () => {
      await request(app.getHttpServer()).get('/dealer/costs').set(as(BUYER)).expect(403);
    });
  });

  it('keeps amounts out of the audit trail', async () => {
    await add(DEALER_A, civic.id, cost()).expect(201);

    const entry = audit.record.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(entry.metadata).toEqual({ vehicleId: civic.id, category: 'PURCHASE' });
  });
});
