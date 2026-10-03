import { ForbiddenException, Injectable } from '@nestjs/common';
import { STAFF_ROLE_PERMISSIONS, type DealerStaffRole } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthUser } from '../../../common/auth/auth-user';
import type { AccountingContext } from './context';

/**
 * Resolves which dealership's books the caller may touch, and with which role.
 *
 * The owner of a dealership is its OWNER. Anyone else needs a DealerMember
 * row the owner created. A platform administrator gets nothing here by
 * virtue of being an administrator: a dealer's books are the dealer's (D-065).
 * Someone on more than one dealership's staff chooses one with the
 * `x-dealer-id` header, and it must be one of theirs.
 */
@Injectable()
export class AccountingAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(user: AuthUser, requestedDealerId?: string | null): Promise<AccountingContext> {
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
      throw new ForbiddenException('Accounting is available to dealership owners and their staff');
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
      permissions: new Set(STAFF_ROLE_PERMISSIONS[chosen.role]),
    };
  }
}
