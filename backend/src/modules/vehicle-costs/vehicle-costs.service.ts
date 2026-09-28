import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  COST_OVERVIEW_SCOPE_STATUSES,
  grossMarginCents,
  summariseVehicleCosts,
  type CostOverviewPage,
  type CostOverviewQuery,
  type CostOverviewRow,
  type CostOverviewSummary,
  type UpdateVehicleCostInput,
  type VehicleCostBreakdown,
  type VehicleCostEntry,
  type VehicleCostInput,
} from '@vintrax/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';

/**
 * The most vehicles the overview totals in one pass. A rooftop's whole history
 * is a four-figure number; this is a guard against a pathological account, not
 * a limit anyone meets. Totals over more than this are reported as such.
 */
const MAX_OVERVIEW_VEHICLES = 10_000;

const COST_SELECT = {
  id: true,
  vehicleId: true,
  category: true,
  description: true,
  amountCents: true,
  incurredOn: true,
  vendor: true,
  reference: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.VehicleCostSelect;

type CostRow = Prisma.VehicleCostGetPayload<{ select: typeof COST_SELECT }>;

/**
 * What a dealer spent on each vehicle.
 *
 * Every read and write resolves ownership the same way: the session's user,
 * then a vehicle whose `sellerId` is that user, then a cost on that vehicle.
 * The request never supplies an owner, and the vehicle id it supplies is only
 * ever used together with `sellerId: user.id`. Anything outside the caller's
 * inventory is "not found" — the same answer as a cost that does not exist, so
 * the API does not confirm that someone else's record is there.
 *
 * Costs are the dealer's alone. Administrators are not given a way in here;
 * nothing in the marketplace needs another business's margins.
 */
@Injectable()
export class VehicleCostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async breakdown(vehicleId: string, user: AuthUser): Promise<VehicleCostBreakdown> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, sellerId: user.id },
      select: {
        id: true,
        title: true,
        year: true,
        make: true,
        model: true,
        trim: true,
        vin: true,
        stockNumber: true,
        priceCad: true,
        status: true,
        images: { select: { url: true }, orderBy: { position: 'asc' }, take: 1 },
        costs: {
          select: COST_SELECT,
          orderBy: [{ incurredOn: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    const entries = vehicle.costs.map(toEntry);
    return {
      vehicle: {
        id: vehicle.id,
        title: vehicle.title,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        trim: vehicle.trim,
        vin: vehicle.vin,
        stockNumber: vehicle.stockNumber,
        priceCad: vehicle.priceCad,
        status: vehicle.status,
        primaryImageUrl: vehicle.images[0]?.url ?? null,
      },
      entries,
      totals: summariseVehicleCosts(entries, vehicle.priceCad),
    };
  }

  async add(vehicleId: string, input: VehicleCostInput, user: AuthUser): Promise<VehicleCostEntry> {
    await this.requireOwnedVehicle(vehicleId, user);

    const cost = await this.prisma.vehicleCost.create({
      data: {
        // The checked id, not anything else from the request.
        vehicleId,
        category: input.category,
        description: input.description,
        amountCents: input.amountCents,
        incurredOn: asDate(input.incurredOn),
        vendor: input.vendor,
        reference: input.reference,
        notes: input.notes,
        recordedById: user.id,
      },
      select: COST_SELECT,
    });

    await this.record('vehicle_cost.created', cost, user);
    return toEntry(cost);
  }

  async update(
    costId: string,
    input: UpdateVehicleCostInput,
    user: AuthUser,
  ): Promise<VehicleCostEntry> {
    await this.requireOwnedCost(costId, user);

    const data: Prisma.VehicleCostUpdateInput = {};
    if (input.category !== undefined) data.category = input.category;
    if (input.description !== undefined) data.description = input.description;
    if (input.amountCents !== undefined) data.amountCents = input.amountCents;
    if (input.incurredOn !== undefined) data.incurredOn = asDate(input.incurredOn);
    if (input.vendor !== undefined) data.vendor = input.vendor;
    if (input.reference !== undefined) data.reference = input.reference;
    if (input.notes !== undefined) data.notes = input.notes;

    const cost = await this.prisma.vehicleCost.update({
      where: { id: costId },
      data,
      select: COST_SELECT,
    });

    await this.record('vehicle_cost.updated', cost, user);
    return toEntry(cost);
  }

  async remove(costId: string, user: AuthUser): Promise<void> {
    const cost = await this.requireOwnedCost(costId, user);
    await this.prisma.vehicleCost.delete({ where: { id: costId } });
    await this.record('vehicle_cost.deleted', cost, user);
  }

  /**
   * The cost table and its headline numbers, over one scope of the caller's
   * inventory.
   *
   * Totalled here rather than in the browser: the page receives the figures
   * for its rows and the aggregates, never every cost line of every vehicle.
   * The per-vehicle sums come from one grouped query, so sorting by total or
   * by margin is exact across pages rather than per page.
   */
  async overview(user: AuthUser, query: CostOverviewQuery): Promise<CostOverviewPage> {
    const where = this.overviewWhere(user, query);

    const vehicles = await this.prisma.vehicle.findMany({
      where,
      select: {
        id: true,
        title: true,
        vin: true,
        stockNumber: true,
        status: true,
        priceCad: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: MAX_OVERVIEW_VEHICLES,
    });

    const sums =
      vehicles.length === 0
        ? []
        : await this.prisma.vehicleCost.groupBy({
            by: ['vehicleId', 'category'],
            // The ids are the caller's own, from the scoped query above; the
            // seller filter is repeated so this query stands on its own.
            where: {
              vehicleId: { in: vehicles.map((vehicle) => vehicle.id) },
              vehicle: { sellerId: user.id },
            },
            _sum: { amountCents: true },
            _count: { _all: true },
            _max: { updatedAt: true },
          });

    const perVehicle = new Map<
      string,
      {
        entries: { category: CostRow['category']; amountCents: number }[];
        count: number;
        updatedAt: Date | null;
      }
    >();
    for (const row of sums) {
      const current = perVehicle.get(row.vehicleId) ?? { entries: [], count: 0, updatedAt: null };
      current.entries.push({ category: row.category, amountCents: row._sum.amountCents ?? 0 });
      current.count += row._count._all;
      const latest = row._max.updatedAt;
      if (latest && (!current.updatedAt || latest > current.updatedAt)) current.updatedAt = latest;
      perVehicle.set(row.vehicleId, current);
    }

    let rows: CostOverviewRow[] = vehicles.map((vehicle) => {
      const costs = perVehicle.get(vehicle.id);
      const totals = summariseVehicleCosts(costs?.entries ?? [], vehicle.priceCad);
      return {
        vehicleId: vehicle.id,
        title: vehicle.title,
        vin: vehicle.vin,
        stockNumber: vehicle.stockNumber,
        status: vehicle.status,
        priceCad: vehicle.priceCad,
        costCount: costs?.count ?? 0,
        costsUpdatedAt: costs?.updatedAt?.toISOString() ?? null,
        ...totals,
      };
    });

    if (query.withCostsOnly) rows = rows.filter((row) => row.costCount > 0);

    const summary = summarise(query.scope, rows);
    const sorted = sortRows(rows, query.sort);
    const start = (query.page - 1) * query.pageSize;

    return {
      summary,
      items: sorted.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: sorted.length,
      totalPages: Math.max(1, Math.ceil(sorted.length / query.pageSize)),
    };
  }

  /** The vehicles an overview covers. Always the caller's own. */
  overviewWhere(user: AuthUser, query: CostOverviewQuery): Prisma.VehicleWhereInput {
    const terms = (query.q ?? '').split(/\s+/).filter(Boolean).slice(0, 6);
    return {
      sellerId: user.id,
      status: { in: [...COST_OVERVIEW_SCOPE_STATUSES[query.scope]] },
      ...(terms.length > 0
        ? {
            AND: terms.map((term) => ({
              OR: [
                { title: { contains: term, mode: 'insensitive' as const } },
                { vin: { contains: term, mode: 'insensitive' as const } },
                { stockNumber: { contains: term, mode: 'insensitive' as const } },
                { make: { contains: term, mode: 'insensitive' as const } },
                { model: { contains: term, mode: 'insensitive' as const } },
              ],
            })),
          }
        : {}),
    };
  }

  private async requireOwnedVehicle(vehicleId: string, user: AuthUser): Promise<void> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, sellerId: user.id },
      select: { id: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
  }

  private async requireOwnedCost(costId: string, user: AuthUser): Promise<CostRow> {
    const cost = await this.prisma.vehicleCost.findFirst({
      where: { id: costId, vehicle: { sellerId: user.id } },
      select: COST_SELECT,
    });
    if (!cost) throw new NotFoundException('Cost not found');
    return cost;
  }

  /**
   * The audit trail records that a cost changed and on which vehicle, but not
   * the amount: the log is read by platform staff, and a dealer's buying prices
   * are not theirs to read.
   */
  private record(action: string, cost: CostRow, user: AuthUser): Promise<void> {
    return this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action,
      entityType: 'VehicleCost',
      entityId: cost.id,
      metadata: { vehicleId: cost.vehicleId, category: cost.category },
    });
  }
}

function asDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toEntry(row: CostRow): VehicleCostEntry {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    category: row.category,
    description: row.description,
    amountCents: row.amountCents,
    incurredOn: row.incurredOn.toISOString().slice(0, 10),
    vendor: row.vendor,
    reference: row.reference,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The cards above the table. Exported for tests. */
export function summarise(
  scope: CostOverviewSummary['scope'],
  rows: readonly CostOverviewRow[],
): CostOverviewSummary {
  let purchaseCents = 0;
  let repairCents = 0;
  let otherCents = 0;
  let marginSum = 0;
  let costed = 0;
  for (const row of rows) {
    purchaseCents += row.purchaseCents;
    repairCents += row.repairCents;
    otherCents += row.otherCents;
    if (row.costCount > 0) {
      costed += 1;
      marginSum += grossMarginCents(row.priceCad, row.totalCents, true) ?? 0;
    }
  }
  const totalCostCents = purchaseCents + repairCents + otherCents;
  return {
    scope,
    vehicleCount: rows.length,
    costedVehicleCount: costed,
    totalCostCents,
    purchaseCents,
    repairCents,
    otherCents,
    averageCostCents: costed > 0 ? Math.round(totalCostCents / costed) : null,
    averageGrossMarginCents: costed > 0 ? Math.round(marginSum / costed) : null,
  };
}

/**
 * Orders the table. Vehicles with no costs have no margin, so they sort after
 * every costed vehicle whichever way margin is ordered — "lowest margin first"
 * should show the tightest deal, not a car nobody has costed yet.
 */
export function sortRows(
  rows: readonly CostOverviewRow[],
  sort: CostOverviewQuery['sort'],
): CostOverviewRow[] {
  const copy = [...rows];
  const lastUpdated = (row: CostOverviewRow) =>
    row.costsUpdatedAt ? Date.parse(row.costsUpdatedAt) : 0;
  const margin = (row: CostOverviewRow, direction: 1 | -1) =>
    row.grossMarginCents === null ? Number.POSITIVE_INFINITY : direction * row.grossMarginCents;

  switch (sort) {
    case 'total_desc':
      return copy.sort((a, b) => b.totalCents - a.totalCents);
    case 'total_asc':
      return copy.sort((a, b) => a.totalCents - b.totalCents);
    case 'margin_desc':
      return copy.sort((a, b) => margin(a, -1) - margin(b, -1));
    case 'margin_asc':
      return copy.sort((a, b) => margin(a, 1) - margin(b, 1));
    case 'updated_desc':
    default:
      // Costed vehicles by their latest cost change; the rest keep the
      // vehicle order they arrived in (most recently updated first).
      return copy.sort((a, b) => lastUpdated(b) - lastUpdated(a));
  }
}
