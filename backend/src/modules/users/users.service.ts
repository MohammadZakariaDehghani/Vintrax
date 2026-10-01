import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Address,
  AddressInput,
  AdminCreateUserInput,
  AdminSetPasswordInput,
  Paginated,
  PublicUser,
  UpdateProfileInput,
  UpdateUserRoleInput,
  UpdateUserStatusInput,
} from '@vintrax/shared';
import { canAdministerUser, canAssignRole } from '@vintrax/shared';
import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { permissionsFor, type AuthUser } from '../../common/auth/auth-user';

/** Matches the cost the auth service hashes with, so accounts are consistent. */
const BCRYPT_ROUNDS = 12;

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
        username: true,
        postalCode: true,
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
      username: user.username,
      postalCode: user.postalCode,
      dealer: user.dealer,
      permissions: permissionsFor(user.role),
      createdAt: user.createdAt.toISOString(),
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<PublicUser> {
    if (input.username !== undefined) {
      const holder = await this.prisma.user.findUnique({
        where: { username: input.username },
        select: { id: true },
      });
      if (holder && holder.id !== userId) {
        throw new ConflictException('That username is taken. Try another.');
      }
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.username !== undefined ? { username: input.username } : {}),
        ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
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

  /**
   * Reads one account as an administrator.
   *
   * A 404 rather than a 403 when an admin looks at another administrator, which
   * matches `updateStatus`: refusing tells you the account exists, and who the
   * other administrators are is not something an admin needs to learn by
   * probing ids.
   */
  async getUserAsAdmin(targetUserId: string, actor: AuthUser): Promise<PublicUser> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { role: true },
    });
    if (!target) throw new NotFoundException('User not found');
    if (!canAdministerUser(actor.role, target.role)) {
      throw new NotFoundException('User not found');
    }
    return this.getPublicUser(targetUserId);
  }

  /**
   * Creates an account directly, as an administrator.
   *
   * This is the only supported way to make the first administrator. Before it
   * existed the answer was an UPDATE against the database, which bypassed the
   * audit trail entirely — a role change that left no record of who made it.
   */
  async createUser(input: AdminCreateUserInput, actor: AuthUser): Promise<PublicUser> {
    // The anti-escalation check. Validation accepts every role; whether this
    // caller may use the one they asked for is decided here, on the server.
    if (!canAssignRole(actor.role, input.role)) {
      throw new ForbiddenException(`You may not create an account with the role ${input.role}`);
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    const created = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        status: 'ACTIVE',
        emailVerified: input.emailVerified,
        emailVerifiedAt: input.emailVerified ? new Date() : null,
        phone: input.phone ?? null,
        province: input.province ?? null,
        city: input.city ?? null,
        // A dealer account without its dealership is a meaningless half-state,
        // so both rows are created in one write — the same rule registration
        // follows. The dealership starts PENDING: an administrator creating the
        // login is not the same act as verifying the business, and collapsing
        // the two would route around the verification flow.
        ...(input.role === 'DEALER' && input.dealershipName
          ? {
              dealer: {
                create: {
                  name: input.dealershipName,
                  slug: await this.uniqueDealerSlug(input.dealershipName),
                  businessNumber: input.businessNumber ?? null,
                  licenceNumber: input.licenceNumber ?? null,
                  province: input.province ?? null,
                  city: input.city ?? null,
                },
              },
            }
          : {}),
      },
      select: { id: true },
    });

    return this.getPublicUser(created.id);
  }

  /**
   * Changes an account's role.
   *
   * The role is read from the database on every request by the JWT strategy, so
   * this takes effect on the target's very next call rather than when their
   * token expires. That is why sessions are not revoked here: there is no
   * window in which the old role still applies.
   */
  async updateRole(
    targetUserId: string,
    input: UpdateUserRoleInput,
    actor: AuthUser,
  ): Promise<PublicUser> {
    // Nobody edits their own role, super admins included. This is the rule that
    // makes "users must not be able to grant themselves additional permissions"
    // true by construction rather than by trusting the matrix, and it also stops
    // the last super admin demoting themselves out of the platform by accident.
    if (targetUserId === actor.id) {
      throw new ForbiddenException('You cannot change your own role');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, dealer: { select: { id: true } } },
    });
    if (!target) throw new NotFoundException('User not found');

    if (!canAdministerUser(actor.role, target.role)) {
      throw new NotFoundException('User not found');
    }
    if (!canAssignRole(actor.role, input.role)) {
      throw new ForbiddenException(`You may not assign the role ${input.role}`);
    }

    if (target.role === input.role) return this.getPublicUser(targetUserId);

    // Losing the last super admin locks everyone out of the settings and of
    // this endpoint, and no amount of admin access recovers it.
    if (target.role === 'SUPER_ADMIN') {
      const remaining = await this.prisma.user.count({
        where: { role: 'SUPER_ADMIN', id: { not: targetUserId }, status: 'ACTIVE' },
      });
      if (remaining === 0) {
        throw new ForbiddenException(
          'This is the last active super admin. Promote another account first.',
        );
      }
    }

    // Promoting into DEALER needs a dealership, which this endpoint has no way
    // to collect. Refuse rather than create a dealer with no business behind it.
    if (input.role === 'DEALER' && !target.dealer) {
      throw new ForbiddenException(
        'This account has no dealership. Create a dealer account instead, so the dealership is created with it.',
      );
    }

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: input.role },
    });

    return this.getPublicUser(targetUserId);
  }

  /** Derives a URL-safe dealer slug, suffixing on collision. */
  async uniqueDealerSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'dealer';

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const taken = await this.prisma.dealer.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return `${base}-${randomBytes(3).toString('hex')}`;
  }

  /**
   * Sets an account's password, as an administrator.
   *
   * The everyday path for a password is `PATCH /auth/password`, which proves
   * the caller knows the current one. This is the path for when nobody can: a
   * locked-out user with no working email, an account handed over between
   * staff. The proof it substitutes is `user:manage` plus the same
   * `canAdministerUser` rule the rest of this file uses, so an ADMIN cannot
   * reach another administrator's account — which would otherwise be a
   * one-request takeover of a peer, or of a super admin.
   *
   * Aimed at the caller's own account it refuses rather than succeeding.
   * Allowing it would make this a way to change your own password without
   * knowing the current one, which is exactly what the other endpoint exists to
   * prevent, and an unlocked admin session should not be enough to lock the
   * real owner out.
   */
  async setPassword(
    targetUserId: string,
    input: AdminSetPasswordInput,
    actor: AuthUser,
  ): Promise<PublicUser> {
    if (targetUserId === actor.id) {
      throw new ForbiddenException(
        'Use your own password settings to change your password — that path checks your current one.',
      );
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true },
    });
    if (!target) throw new NotFoundException('User not found');

    // A 404 rather than a 403, for the reason given on getUserAsAdmin.
    if (!canAdministerUser(actor.role, target.role)) {
      throw new NotFoundException('User not found');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetUserId },
        data: { passwordHash },
      }),
      // Every live session ends, the same as when the owner changes it
      // themselves. If this was done because the account was compromised,
      // leaving the intruder's refresh token working defeats the exercise.
      this.prisma.refreshToken.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      // An unconsumed reset link, mailed before this, would otherwise still
      // overwrite the password an administrator just set.
      this.prisma.authToken.updateMany({
        where: { userId: targetUserId, type: 'PASSWORD_RESET', consumedAt: null },
        data: { consumedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'user.password_set_by_admin',
      entityType: 'User',
      entityId: targetUserId,
      // The reason, never the password, and never a hash of it either.
      metadata: { reason: input.reason ?? null },
    });

    return this.getPublicUser(targetUserId);
  }

  async updateStatus(
    targetUserId: string,
    input: UpdateUserStatusInput,
    actor: AuthUser,
  ): Promise<PublicUser> {
    // Suspending yourself ends your own sessions and, if you are the only
    // administrator, ends everyone's access to administration with them.
    if (targetUserId === actor.id) {
      throw new ForbiddenException('You cannot change your own account status');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true },
    });
    if (!target) throw new NotFoundException('User not found');

    // Only a super admin can act on another administrator.
    if (!canAdministerUser(actor.role, target.role)) {
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
