import type { Prisma } from '@prisma/client';
import type { CrmContext } from './context';

export interface CrmAuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

type Db = Prisma.TransactionClient;

/**
 * Writes the dealer CRM audit trail, inside the caller's transaction when
 * there is one. The table is append-only at the database level.
 */
export async function crmAudit(
  db: Db,
  ctx: Pick<CrmContext, 'dealerId' | 'userId' | 'actorEmail' | 'system'>,
  entry: CrmAuditEntry,
): Promise<void> {
  await db.crmAuditLog.create({
    data: {
      scope: 'DEALER',
      dealerId: ctx.dealerId,
      actorId: ctx.system ? null : ctx.userId,
      actorEmail: ctx.system ? 'system' : ctx.actorEmail,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: toJson(entry.before),
      after: toJson(entry.after),
    },
  });
}

/** The support CRM's audit trail: platform-wide, no dealership. */
export async function supportAudit(
  db: Db,
  actor: { id: string | null; email: string | null },
  entry: CrmAuditEntry & { dealerId?: string | null },
): Promise<void> {
  await db.crmAuditLog.create({
    data: {
      scope: 'SUPPORT',
      dealerId: entry.dealerId ?? null,
      actorId: actor.id,
      actorEmail: actor.email ?? 'system',
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: toJson(entry.before),
      after: toJson(entry.after),
    },
  });
}

export function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  ) as Prisma.InputJsonValue;
}
