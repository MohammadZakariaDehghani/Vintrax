import { ForbiddenException, Injectable } from '@nestjs/common';
import { CRM_ROLE_PERMISSIONS, type DealerStaffRole } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthUser } from '../../../common/auth/auth-user';
import type { CrmContext } from './context';

/**
 * Resolves which dealership's CRM the caller may work, and with which role —
 * the same staff model as accounting (D-065): the owner is OWNER, anyone else
 * needs a DealerMember row. A platform administrator gets nothing here by
 * virtue of being an administrator: a dealer's leads are the dealer's.
 * Someone on more than one dealership's staff chooses one with the
 * `x-dealer-id` header, and it must be one of theirs.
 */
@Injectable()
export class CrmAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(user: AuthUser, requestedDealerId?: string | null): Promise<CrmContext> {
    const memberships: Array<{ dealerId: string; role: DealerStaffRole; ownerUserId: string }> = [];

    const owned = await this.prisma.dealer.findUnique({
      where: { ownerId: user.id },
      select: { id: true, ownerId: true },
    });
    if (owned) memberships.push({ dealerId: owned.id, role: 'OWNER', ownerUserId: owned.ownerId });

    const staff = await this.prisma.dealerMember.findMany({
      where: { userId: user.id },
      select: { dealerId: true, role: true, dealer: { select: { ownerId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    for (const row of staff) {
      if (row.dealerId === owned?.id) continue;
      memberships.push({ dealerId: row.dealerId, role: row.role, ownerUserId: row.dealer.ownerId });
    }

    if (memberships.length === 0) {
      throw new ForbiddenException('The CRM is available to dealership owners and their staff');
    }
    const chosen = requestedDealerId
      ? memberships.find((membership) => membership.dealerId === requestedDealerId)
      : memberships[0];
    if (!chosen) throw new ForbiddenException('You are not on that dealership’s staff');

    return {
      dealerId: chosen.dealerId,
      ownerUserId: chosen.ownerUserId,
      userId: user.id,
      actorEmail: user.email,
      role: chosen.role,
      permissions: new Set(CRM_ROLE_PERMISSIONS[chosen.role]),
    };
  }
}
