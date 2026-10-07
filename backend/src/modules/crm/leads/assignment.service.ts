import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

type Db = Prisma.TransactionClient;

export interface AssignableLead {
  dealerId: string;
  sourceId: string | null;
  province: string | null;
  vehicleMake: string | null;
}

/**
 * Who a new lead goes to. In RULES mode the first matching rule wins (by
 * source, vehicle make or province, or ANY); a rule naming a team hands the
 * lead round-robin within it. In ROUND_ROBIN mode it goes round the whole
 * sales floor. MANUAL leaves it unassigned for a manager.
 */
@Injectable()
export class AssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async pick(
    lead: AssignableLead,
    db: Db = this.prisma,
  ): Promise<{ userId: string | null; team: string | null }> {
    const settings = await db.crmSettings.findUnique({ where: { dealerId: lead.dealerId } });
    const mode = settings?.assignmentMode ?? 'ROUND_ROBIN';
    if (mode === 'MANUAL') return { userId: null, team: null };

    if (mode === 'RULES') {
      const rules = await db.crmAssignmentRule.findMany({
        where: { dealerId: lead.dealerId, isActive: true },
        orderBy: { position: 'asc' },
      });
      const source = lead.sourceId
        ? await db.crmLeadSource.findUnique({
            where: { id: lead.sourceId },
            select: { key: true, label: true },
          })
        : null;
      for (const rule of rules) {
        const value = rule.matchValue?.trim().toLowerCase() ?? '';
        const matches =
          rule.matchField === 'ANY' ||
          (rule.matchField === 'SOURCE' &&
            !!source &&
            (source.key.toLowerCase() === value || source.label.toLowerCase() === value)) ||
          (rule.matchField === 'VEHICLE_MAKE' && lead.vehicleMake?.toLowerCase() === value) ||
          (rule.matchField === 'PROVINCE' && lead.province?.toLowerCase() === value);
        if (!matches) continue;
        if (
          rule.assignToUserId &&
          (await this.isSalesStaff(db, lead.dealerId, rule.assignToUserId))
        ) {
          return { userId: rule.assignToUserId, team: rule.assignToTeam };
        }
        if (rule.assignToTeam) {
          const userId = await this.roundRobin(db, lead.dealerId, rule.assignToTeam);
          if (userId) return { userId, team: rule.assignToTeam };
        }
      }
    }
    return { userId: await this.roundRobin(db, lead.dealerId, null), team: null };
  }

  /** The people leads can go to: the owner and staff who sell. */
  async salesStaff(dealerId: string, db: Db = this.prisma): Promise<string[]> {
    const dealer = await db.dealer.findUnique({
      where: { id: dealerId },
      select: { ownerId: true },
    });
    const members = await db.dealerMember.findMany({
      where: { dealerId, role: { in: ['MANAGER', 'SALES_MANAGER', 'SALES_USER'] } },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, role: true },
    });
    const sellers = members
      .filter((member) => member.role === 'SALES_USER')
      .map((member) => member.userId);
    // With salespeople on staff, leads go to them; otherwise to the managers and the owner.
    if (sellers.length) return sellers;
    const others = members.map((member) => member.userId);
    return dealer ? [dealer.ownerId, ...others.filter((id) => id !== dealer.ownerId)] : others;
  }

  async isSalesStaff(db: Db, dealerId: string, userId: string): Promise<boolean> {
    const dealer = await db.dealer.findUnique({
      where: { id: dealerId },
      select: { ownerId: true },
    });
    if (dealer?.ownerId === userId) return true;
    const member = await db.dealerMember.findUnique({
      where: { dealerId_userId: { dealerId, userId } },
      select: { role: true },
    });
    return !!member && member.role !== 'ACCOUNTANT';
  }

  /** Next person in line, advancing the dealer's cursor atomically. */
  private async roundRobin(db: Db, dealerId: string, team: string | null): Promise<string | null> {
    let pool: string[];
    if (team) {
      const members = await db.crmTeamMember.findMany({
        where: { dealerId, team },
        orderBy: { userId: 'asc' },
        select: { userId: true },
      });
      pool = members.map((member) => member.userId);
    } else {
      pool = await this.salesStaff(dealerId, db);
    }
    if (pool.length === 0) return null;
    const [row] = await db.$queryRaw<Array<{ cursor: number }>>`
      UPDATE "CrmSettings" SET "roundRobinCursor" = "roundRobinCursor" + 1
      WHERE "dealerId" = ${dealerId}::uuid
      RETURNING "roundRobinCursor" - 1 AS cursor`;
    const cursor = row?.cursor ?? 0;
    return pool[cursor % pool.length] ?? null;
  }
}
