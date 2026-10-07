import type { AutomationCondition, ConditionField } from '@vintrax/shared';
import type { PrismaService } from '../../../common/prisma/prisma.service';

export type Facts = Partial<Record<ConditionField, string | number | boolean | string[] | null>>;

const DAY = 86_400_000;

/** What the conditions can ask about a lead, read fresh each time a step runs. */
export async function leadFacts(
  prisma: PrismaService,
  leadId: string,
  now = new Date(),
): Promise<Facts | null> {
  const lead = await prisma.crmLead.findUnique({
    where: { id: leadId },
    select: {
      score: true,
      temperature: true,
      province: true,
      assignedToId: true,
      lastRepliedAt: true,
      lastContactAt: true,
      createdAt: true,
      customerId: true,
      mergedIntoId: true,
      status: { select: { key: true, kind: true } },
      source: { select: { key: true } },
      vehicle: { select: { make: true, priceCad: true } },
      tags: { select: { tag: { select: { name: true } } } },
    },
  });
  if (!lead || lead.mergedIntoId) return null;
  const [opened, clicked, appointment] = await Promise.all([
    prisma.crmEmail.count({ where: { leadId, openedAt: { not: null } } }),
    prisma.crmEmail.count({ where: { leadId, clickedAt: { not: null } } }),
    prisma.crmAppointment.findFirst({
      where: { leadId },
      orderBy: { startsAt: 'desc' },
      select: { status: true },
    }),
  ]);
  const since = lead.lastContactAt ?? lead.createdAt;
  return {
    'lead.status': lead.status.key,
    'lead.status_kind': lead.status.kind,
    'lead.source': lead.source?.key ?? null,
    'lead.score': lead.score,
    'lead.temperature': lead.temperature,
    'lead.province': lead.province,
    'lead.assigned': !!lead.assignedToId,
    'lead.tags': lead.tags.map((entry) => entry.tag.name),
    'lead.has_replied': !!lead.lastRepliedAt,
    'lead.has_opened': opened > 0,
    'lead.has_clicked': clicked > 0,
    'lead.days_since_contact': Math.floor((now.getTime() - since.getTime()) / DAY),
    'lead.days_since_created': Math.floor((now.getTime() - lead.createdAt.getTime()) / DAY),
    'lead.is_customer': !!lead.customerId,
    'vehicle.make': lead.vehicle?.make ?? null,
    'vehicle.price': lead.vehicle?.priceCad ?? null,
    'appointment.status': appointment?.status ?? null,
  };
}

export async function ticketFacts(prisma: PrismaService, ticketId: string): Promise<Facts | null> {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: {
      status: true,
      priority: true,
      lastPublicReplyBy: true,
      category: { select: { key: true } },
    },
  });
  if (!ticket) return null;
  return {
    'ticket.status': ticket.status,
    'ticket.priority': ticket.priority,
    'ticket.category': ticket.category?.key ?? null,
    'ticket.user_replied': ticket.lastPublicReplyBy === 'REQUESTER',
  };
}

const lower = (value: unknown) => String(value ?? '').toLowerCase();

/** One condition against the facts. A fact that is missing never matches. */
export function evaluate(condition: AutomationCondition, facts: Facts): boolean {
  const actual = facts[condition.field];
  const expected = condition.value;
  switch (condition.op) {
    case 'is_true':
      return actual === true;
    case 'is_false':
      return actual === false || actual === null || actual === undefined;
    case 'eq':
      return Array.isArray(actual)
        ? actual.some((item) => lower(item) === lower(expected))
        : lower(actual) === lower(expected);
    case 'neq':
      return Array.isArray(actual)
        ? !actual.some((item) => lower(item) === lower(expected))
        : lower(actual) !== lower(expected);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (
        actual === null ||
        actual === undefined ||
        typeof actual === 'boolean' ||
        Array.isArray(actual)
      )
        return false;
      const a = Number(actual);
      const b = Number(expected);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return condition.op === 'gt'
        ? a > b
        : condition.op === 'gte'
          ? a >= b
          : condition.op === 'lt'
            ? a < b
            : a <= b;
    }
    case 'in': {
      const options = (Array.isArray(expected) ? expected : String(expected ?? '').split(',')).map(
        lower,
      );
      return Array.isArray(actual)
        ? actual.some((item) => options.includes(lower(item)))
        : options.includes(lower(actual));
    }
    case 'contains':
      return Array.isArray(actual)
        ? actual.some((item) => lower(item) === lower(expected))
        : lower(actual).includes(lower(expected));
    default:
      return false;
  }
}

/** All must hold. */
export function evaluateAll(conditions: AutomationCondition[] | undefined, facts: Facts): boolean {
  return (conditions ?? []).every((condition) => evaluate(condition, facts));
}
