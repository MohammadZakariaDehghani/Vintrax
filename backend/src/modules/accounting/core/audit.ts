import type { Prisma } from '@prisma/client';
import type { AccountingContext } from './context';

export interface AccountingAuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/**
 * Writes the accounting audit trail inside the caller's transaction, so the
 * record of a posting commits or rolls back with the posting itself. The
 * table is append-only at the database level.
 */
export async function recordAudit(
  tx: Prisma.TransactionClient,
  ctx: Pick<AccountingContext, 'dealerId' | 'userId' | 'actorEmail'>,
  entry: AccountingAuditEntry,
): Promise<void> {
  await tx.accountingAuditLog.create({
    data: {
      dealerId: ctx.dealerId,
      actorId: ctx.userId,
      actorEmail: ctx.actorEmail,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: toJson(entry.before),
      after: toJson(entry.after),
      reason: entry.reason ?? null,
    },
  });
}

/** Decimals and dates as strings; bigints as strings. */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item)),
  ) as Prisma.InputJsonValue;
}
