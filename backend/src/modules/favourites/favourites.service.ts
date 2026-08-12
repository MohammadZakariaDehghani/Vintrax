import { Injectable, NotFoundException } from '@nestjs/common';
import type { VehicleSummary, Paginated } from '@atlas/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { vehicleSummarySelect, toVehicleSummary } from '../vehicles/vehicles.mapper';

@Injectable()
export class FavouritesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent: favouriting an already-favourited vehicle is a no-op. */
  async add(vehicleId: string, user: AuthUser): Promise<void> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, status: true },
    });
    if (!vehicle || vehicle.status === 'DRAFT' || vehicle.status === 'ARCHIVED') {
      throw new NotFoundException('Vehicle not found');
    }

    await this.prisma.favourite.upsert({
      where: { userId_vehicleId: { userId: user.id, vehicleId } },
      update: {},
      create: { userId: user.id, vehicleId },
    });
  }

  /** Idempotent: removing a vehicle that was never favourited succeeds. */
  async remove(vehicleId: string, user: AuthUser): Promise<void> {
    await this.prisma.favourite.deleteMany({ where: { userId: user.id, vehicleId } });
  }

  async list(user: AuthUser, page: number, pageSize: number): Promise<Paginated<VehicleSummary>> {
    const where = { userId: user.id };

    const [total, rows] = await Promise.all([
      this.prisma.favourite.count({ where }),
      this.prisma.favourite.findMany({
        where,
        select: { vehicle: { select: vehicleSummarySelect } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // Everything in this collection is favourited by definition.
    const favouritedIds = new Set(rows.map((row) => row.vehicle.id));

    return {
      items: rows.map((row) => toVehicleSummary(row.vehicle, favouritedIds)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}
