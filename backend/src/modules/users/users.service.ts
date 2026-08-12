import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  Address,
  AddressInput,
  Paginated,
  PublicUser,
  UpdateProfileInput,
  UpdateUserStatusInput,
} from '@atlas/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { permissionsFor, type AuthUser } from '../../common/auth/auth-user';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The self-view of an account. Never used to describe someone else. */
  async getPublicUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        emailVerified: true,
        phone: true,
        province: true,
        city: true,
        avatarUrl: true,
        createdAt: true,
        dealer: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            verified: true,
            logoUrl: true,
            city: true,
            province: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: `${user.firstName} ${user.lastName}`.trim(),
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
      phone: user.phone,
      province: user.province,
      city: user.city,
      avatarUrl: user.avatarUrl,
      dealer: user.dealer,
      permissions: permissionsFor(user.role),
      createdAt: user.createdAt.toISOString(),
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<PublicUser> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.province !== undefined ? { province: input.province } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
      },
    });
    return this.getPublicUser(userId);
  }

  // --- Addresses -------------------------------------------------------------

  async listAddresses(userId: string): Promise<Address[]> {
    const rows = await this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.toAddress(row));
  }

  async createAddress(userId: string, input: AddressInput): Promise<Address> {
    // Only one default per address type, so promoting one demotes the rest.
    const created = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.address.updateMany({
          where: { userId, type: input.type },
          data: { isDefault: false },
        });
      }
      return tx.address.create({ data: { ...input, userId } });
    });
    return this.toAddress(created);
  }

  async deleteAddress(userId: string, addressId: string): Promise<void> {
    const address = await this.prisma.address.findUnique({
      where: { id: addressId },
      select: { userId: true },
    });
    if (!address || address.userId !== userId) throw new NotFoundException('Address not found');
    await this.prisma.address.delete({ where: { id: addressId } });
  }

  // --- Administration --------------------------------------------------------

  async listUsers(
    page: number,
    pageSize: number,
    filters: { role?: string; status?: string; q?: string } = {},
  ): Promise<Paginated<PublicUser>> {
    const where: Prisma.UserWhereInput = {
      ...(filters.role ? { role: filters.role as Prisma.EnumUserRoleFilter['equals'] } : {}),
      ...(filters.status
        ? { status: filters.status as Prisma.EnumUserStatusFilter['equals'] }
        : {}),
      ...(filters.q
        ? {
            OR: [
              { email: { contains: filters.q, mode: 'insensitive' } },
              { firstName: { contains: filters.q, mode: 'insensitive' } },
              { lastName: { contains: filters.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const items = await Promise.all(rows.map((row) => this.getPublicUser(row.id)));

    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async updateStatus(
    targetUserId: string,
    input: UpdateUserStatusInput,
    actor: AuthUser,
  ): Promise<PublicUser> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true },
    });
    if (!target) throw new NotFoundException('User not found');

    // Only a super admin can act on another administrator.
    if (
      (target.role === 'ADMIN' || target.role === 'SUPER_ADMIN') &&
      actor.role !== 'SUPER_ADMIN'
    ) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetUserId },
        data: { status: input.status },
      }),
      // Suspending an account must also end its live sessions.
      ...(input.status === 'SUSPENDED' || input.status === 'DEACTIVATED'
        ? [
            this.prisma.refreshToken.updateMany({
              where: { userId: targetUserId, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]
        : []),
    ]);

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'user.status_changed',
      entityType: 'User',
      entityId: targetUserId,
      metadata: { status: input.status, reason: input.reason ?? null },
    });

    return this.getPublicUser(targetUserId);
  }

  private toAddress(row: {
    id: string;
    type: Address['type'];
    line1: string;
    line2: string | null;
    city: string;
    province: Address['province'];
    postalCode: string;
    country: string;
    isDefault: boolean;
  }): Address {
    return {
      id: row.id,
      type: row.type,
      line1: row.line1,
      line2: row.line2,
      city: row.city,
      province: row.province,
      postalCode: row.postalCode,
      country: row.country,
      isDefault: row.isDefault,
    };
  }
}
