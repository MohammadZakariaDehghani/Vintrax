import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateInspectionInput,
  InspectionDetail,
  Paginated,
  SubmitInspectionInput,
} from '@vintrax/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService, QUEUE_NAMES } from '../../common/queue/queue.service';
import { isAdmin, type AuthUser } from '../../common/auth/auth-user';

const inspectionDetailSelect = {
  id: true,
  vehicleId: true,
  status: true,
  overallGrade: true,
  summary: true,
  odometerReadingKm: true,
  hasFrameDamage: true,
  hasAccidentHistory: true,
  estimatedReconditioningCad: true,
  scheduledFor: true,
  completedAt: true,
  createdAt: true,
  inspector: { select: { firstName: true, lastName: true } },
  sections: { select: { section: true, rating: true, notes: true } },
  images: {
    select: { id: true, url: true, alt: true, position: true },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.VehicleInspectionSelect;

type InspectionRow = Prisma.VehicleInspectionGetPayload<{ select: typeof inspectionDetailSelect }>;

@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /** Schedules an inspection and assigns it to the calling inspector. */
  async create(input: CreateInspectionInput, inspector: AuthUser): Promise<InspectionDetail> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: input.vehicleId },
      select: { id: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    // One open inspection per vehicle keeps the report unambiguous.
    const open = await this.prisma.vehicleInspection.findFirst({
      where: { vehicleId: input.vehicleId, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
      select: { id: true },
    });
    if (open) {
      throw new BadRequestException('This vehicle already has an inspection in progress');
    }

    const inspection = await this.prisma.vehicleInspection.create({
      data: {
        vehicleId: input.vehicleId,
        inspectorId: inspector.id,
        status: 'SCHEDULED',
        scheduledFor: input.scheduledFor ?? null,
      },
      select: { id: true },
    });

    return this.findById(inspection.id, inspector);
  }

  /**
   * Submits the completed report.
   *
   * Section results are replaced wholesale so a resubmission cannot leave
   * results from an earlier draft behind.
   */
  async submit(
    id: string,
    input: SubmitInspectionInput,
    inspector: AuthUser,
  ): Promise<InspectionDetail> {
    const inspection = await this.requireAssigned(id, inspector);

    if (inspection.status === 'COMPLETED') {
      throw new BadRequestException('This inspection has already been submitted');
    }
    if (inspection.status === 'CANCELLED') {
      throw new BadRequestException('This inspection was cancelled');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.inspectionSectionResult.deleteMany({ where: { inspectionId: id } });
      await tx.inspectionImage.deleteMany({ where: { inspectionId: id } });

      await tx.vehicleInspection.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          overallGrade: input.overallGrade,
          summary: input.summary,
          odometerReadingKm: input.odometerReadingKm,
          hasFrameDamage: input.hasFrameDamage,
          hasAccidentHistory: input.hasAccidentHistory,
          estimatedReconditioningCad: input.estimatedReconditioningCad ?? null,
          completedAt: new Date(),
          sections: {
            create: input.sections.map((section) => ({
              section: section.section,
              rating: section.rating,
              notes: section.notes ?? null,
            })),
          },
          images: {
            create: input.images.map((image, position) => ({
              url: image.url,
              alt: image.alt ?? null,
              position,
            })),
          },
        },
      });
    });

    await this.queue.enqueue(QUEUE_NAMES.notifications, 'inspection-completed', {
      vehicleId: inspection.vehicleId,
      inspectionId: id,
    });

    return this.findById(id, inspector);
  }

  async findById(id: string, viewer?: AuthUser): Promise<InspectionDetail> {
    const row = await this.prisma.vehicleInspection.findUnique({
      where: { id },
      select: inspectionDetailSelect,
    });
    if (!row) throw new NotFoundException('Inspection not found');

    // An in-progress report is visible only to its inspector, the vehicle's
    // seller, and admins — a half-finished condition report is misleading.
    if (row.status !== 'COMPLETED') {
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: row.vehicleId },
        select: { sellerId: true },
      });
      const permitted =
        viewer &&
        (isAdmin(viewer.role) || viewer.role === 'INSPECTOR' || vehicle?.sellerId === viewer.id);
      if (!permitted) throw new NotFoundException('Inspection not found');
    }

    return this.toDetail(row);
  }

  /** The completed report attached to a vehicle, if any. */
  async findForVehicle(vehicleId: string): Promise<InspectionDetail | null> {
    const row = await this.prisma.vehicleInspection.findFirst({
      where: { vehicleId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: inspectionDetailSelect,
    });
    return row ? this.toDetail(row) : null;
  }

  /** The calling inspector's assignments. */
  async listMine(
    inspector: AuthUser,
    page: number,
    pageSize: number,
    status?: string,
  ): Promise<Paginated<InspectionDetail>> {
    const where: Prisma.VehicleInspectionWhereInput = {
      inspectorId: inspector.id,
      ...(status ? { status: status as Prisma.EnumInspectionStatusFilter['equals'] } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.vehicleInspection.count({ where }),
      this.prisma.vehicleInspection.findMany({
        where,
        select: inspectionDetailSelect,
        orderBy: [{ status: 'asc' }, { scheduledFor: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => this.toDetail(row)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  private async requireAssigned(
    id: string,
    inspector: AuthUser,
  ): Promise<{ id: string; vehicleId: string; status: string; inspectorId: string }> {
    const inspection = await this.prisma.vehicleInspection.findUnique({
      where: { id },
      select: { id: true, vehicleId: true, status: true, inspectorId: true },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    if (inspection.inspectorId !== inspector.id && !isAdmin(inspector.role)) {
      throw new ForbiddenException('This inspection is assigned to another inspector');
    }
    return inspection;
  }

  private toDetail(row: InspectionRow): InspectionDetail {
    return {
      id: row.id,
      vehicleId: row.vehicleId,
      status: row.status,
      overallGrade: row.overallGrade,
      hasFrameDamage: row.hasFrameDamage,
      hasAccidentHistory: row.hasAccidentHistory,
      completedAt: row.completedAt?.toISOString() ?? null,
      inspectorName: `${row.inspector.firstName} ${row.inspector.lastName}`.trim(),
      summary: row.summary,
      odometerReadingKm: row.odometerReadingKm,
      estimatedReconditioningCad: row.estimatedReconditioningCad,
      sections: row.sections.map((section) => ({
        section: section.section,
        rating: section.rating,
        notes: section.notes,
      })),
      images: row.images.map((image) => ({
        id: image.id,
        url: image.url,
        alt: image.alt,
        position: image.position,
        // Inspection photos are not run through the vehicle photo pipeline.
        optimized: null,
      })),
      scheduledFor: row.scheduledFor?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
