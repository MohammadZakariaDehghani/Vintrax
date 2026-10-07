import type { CrmTimelineType, Prisma } from '@prisma/client';

type Db = Prisma.TransactionClient;

export interface TimelineEntry {
  dealerId: string;
  leadId: string;
  type: CrmTimelineType;
  title: string;
  /** A person; null when the system recorded it. */
  userId?: string | null;
  notes?: string | null;
  status?: string | null;
  outcome?: string | null;
  nextAction?: string | null;
  vehicleId?: string | null;
  saleId?: string | null;
  emailId?: string | null;
  occurredAt?: Date;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Bookkeeping the system records about a lead, which is not the customer or
 * the dealership doing anything: it goes on the timeline but does not make
 * the lead "active" (inactivity triggers and reports read `lastActivityAt`).
 */
const NOT_ACTIVITY = new Set<CrmTimelineType>([
  'SCORE_CHANGED',
  'AUTOMATION_STARTED',
  'AUTOMATION_STEP',
  'AUTOMATION_STOPPED',
  'TAG_ADDED',
  'TAG_REMOVED',
  'LEAD_ASSIGNED',
  'MERGED',
  'CONSENT_CHANGED',
  'TASK_CREATED',
  'EMAIL_FAILED',
  'EMAIL_BOUNCED',
  'UNSUBSCRIBED',
]);

export function countsAsActivity(type: CrmTimelineType, byPerson: boolean): boolean {
  if (NOT_ACTIVITY.has(type)) return false;
  // An automated email is not a conversation; one a salesperson sent is.
  if (type === 'EMAIL_SENT' && !byPerson) return false;
  return true;
}

/**
 * Adds one entry to a lead's unified timeline — the single history of the
 * relationship — and, for real activity, moves the lead's "last activity" forward.
 */
export async function recordTimeline(db: Db, entry: TimelineEntry) {
  const occurredAt = entry.occurredAt ?? new Date();
  const row = await db.crmActivity.create({
    data: {
      dealerId: entry.dealerId,
      leadId: entry.leadId,
      userId: entry.userId ?? null,
      type: entry.type,
      isSystem: !entry.userId,
      occurredAt,
      title: entry.title.slice(0, 200),
      notes: entry.notes ?? null,
      status: entry.status ?? null,
      outcome: entry.outcome ?? null,
      nextAction: entry.nextAction ?? null,
      vehicleId: entry.vehicleId ?? null,
      saleId: entry.saleId ?? null,
      emailId: entry.emailId ?? null,
      metadata: entry.metadata,
    },
  });
  if (countsAsActivity(entry.type, !!entry.userId)) {
    await db.crmLead.updateMany({
      where: {
        id: entry.leadId,
        OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: occurredAt } }],
      },
      data: { lastActivityAt: occurredAt },
    });
  }
  return row;
}
