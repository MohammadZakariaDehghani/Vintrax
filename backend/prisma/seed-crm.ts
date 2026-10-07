/**
 * Demo CRM data for North Shore Motors and the support desk — for local
 * development and demo servers only, never production data.
 *
 * Leads, activities, tasks and appointments go through the real CRM
 * services, so numbering, scoring, the timeline and consent follow the same
 * rules as live use. The automation engine is not running here, so nothing
 * is enrolled, and any email the services queue is cancelled at the end:
 * the seed never sends mail. It runs once per database.
 */
import type { PrismaClient } from '@prisma/client';
import {
  activitySchema,
  appointmentSchema,
  CRM_ROLE_PERMISSIONS,
  leadSchema,
  taskSchema,
  type UserRole,
} from '@vintrax/shared';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../src/common/auth/auth-user';
import type { Env } from '../src/config/env';
import type { MailService } from '../src/common/mail/mail.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { CrmBus } from '../src/modules/crm/core/bus';
import type { CrmContext } from '../src/modules/crm/core/context';
import { CrmNotifyService } from '../src/modules/crm/core/notify.service';
import { CrmSetupService } from '../src/modules/crm/core/setup.service';
import { ComplianceService } from '../src/modules/crm/email/compliance.service';
import { OutboxService } from '../src/modules/crm/email/outbox.service';
import { AssignmentService } from '../src/modules/crm/leads/assignment.service';
import { LeadsService } from '../src/modules/crm/leads/leads.service';
import { ScoringService } from '../src/modules/crm/leads/scoring.service';
import { TicketsService } from '../src/modules/crm/support/tickets.service';
import { WorkService } from '../src/modules/crm/work/work.service';

const FIRST_LEAD_EMAIL = 'olivia.chen@example.test';
/** Created last: its presence means an earlier run finished. */
const LAST_LEAD_EMAIL = 'ava.nguyen@example.test';

/** The seed sends nothing: in-app notifications are written, email is not. */
const noMail = {
  send: async () => undefined,
  deliver: async () => {
    throw new Error('The CRM seed does not send email');
  },
} as unknown as MailService;

function services(prisma: PrismaService) {
  const config = new ConfigService({
    APP_URL: process.env['APP_URL'] ?? 'http://localhost:3000',
  }) as unknown as ConfigService<Env, true>;
  const bus = new CrmBus();
  const scoring = new ScoringService(prisma);
  const assignment = new AssignmentService(prisma);
  const notify = new CrmNotifyService(prisma, new NotificationsService(prisma, noMail), noMail);
  const leads = new LeadsService(prisma, scoring, assignment, notify, bus);
  const setup = new CrmSetupService(prisma);
  const outbox = new OutboxService(prisma, new ComplianceService(prisma, bus), config);
  return {
    setup,
    leads,
    work: new WorkService(prisma, leads, scoring, assignment, notify, bus),
    tickets: new TicketsService(prisma, outbox, notify, bus, setup, config),
  };
}

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

export async function seedCrm(client: PrismaClient): Promise<string> {
  const owner = await client.user.findUnique({
    where: { email: 'sales@northshoremotors.test' },
    include: { dealer: true },
  });
  if (!owner?.dealer) return 'skipped (no North Shore Motors dealer)';
  const dealer = owner.dealer;
  const seededBefore = await client.crmLead.findMany({
    where: { dealerId: dealer.id, email: { in: [FIRST_LEAD_EMAIL, LAST_LEAD_EMAIL] } },
    select: { email: true },
  });
  if (seededBefore.some((row) => row.email === LAST_LEAD_EMAIL))
    return 'already seeded (left as is)';
  if (seededBefore.length) {
    // Never pile a second partial copy on a first: say so and leave it.
    return `an earlier run stopped part-way (lead ${FIRST_LEAD_EMAIL} exists); delete the demo CRM leads to seed again`;
  }
  const rep = await client.user.findUnique({ where: { email: 'rep@northshoremotors.test' } });
  const admin = await client.user.findUnique({ where: { email: 'admin@vintrax.test' } });
  const buyer = await client.user.findUnique({ where: { email: 'jordan.lee@example.test' } });
  const vehicles = await client.vehicle.findMany({
    where: { sellerId: owner.id, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
    take: 4,
  });
  const startedAt = new Date();

  const prisma = new PrismaService();
  try {
    const s = services(prisma);
    await s.setup.ensure(dealer.id);
    await s.setup.ensureSupport();
    // Identification for the CASL footer; marketing email is refused without an address.
    await prisma.crmSettings.update({
      where: { dealerId: dealer.id },
      data: {
        timezone: 'America/Vancouver',
        senderName: dealer.name,
        replyToEmail: owner.email,
        businessAddress: '1200 Marine Drive, North Vancouver, BC V7P 1T2',
        businessPhone: dealer.phone ?? '604-555-0142',
        businessEmail: owner.email,
        assignmentMode: 'ROUND_ROBIN',
      },
    });

    const ctx: CrmContext = {
      dealerId: dealer.id,
      ownerUserId: owner.id,
      userId: owner.id,
      actorEmail: owner.email,
      role: 'OWNER',
      permissions: new Set(CRM_ROLE_PERMISSIONS.OWNER),
    };
    const statuses = new Map(
      (await prisma.crmLeadStatus.findMany({ where: { dealerId: dealer.id } })).map((row) => [
        row.key,
        row.id,
      ]),
    );
    const sources = new Map(
      (await prisma.crmLeadSource.findMany({ where: { dealerId: dealer.id } })).map((row) => [
        row.key,
        row.id,
      ]),
    );
    const status = (key: string) => statuses.get(key)!;
    const vehicle = (index: number) => vehicles[index % Math.max(1, vehicles.length)]?.id ?? null;

    const seeded: string[] = [];
    const lead = async (input: Record<string, unknown>) => {
      const created = await s.leads.create(ctx, leadSchema.parse(input));
      seeded.push(created.id);
      return created;
    };

    const olivia = await lead({
      firstName: 'Olivia',
      lastName: 'Chen',
      email: FIRST_LEAD_EMAIL,
      phone: '604-555-0181',
      province: 'BC',
      city: 'Burnaby',
      sourceId: sources.get('VEHICLE_DETAIL_PAGE'),
      vehicleId: vehicle(0),
      financingInterest: true,
      tags: ['Finance'],
      assignedToId: rep?.id ?? owner.id,
      consent: {
        type: 'EXPRESS',
        source: 'Vehicle page enquiry form',
        evidence: 'Ticked “Email me offers”',
      },
    });
    await s.leads.logActivity(
      ctx,
      olivia.id,
      activitySchema.parse({
        type: 'CALL',
        title: 'Intro call',
        outcome: 'Wants a test drive this week',
      }),
    );
    await s.leads.changeStatus(ctx, olivia.id, {
      statusId: status('APPOINTMENT_SET'),
      lostReason: null,
    });
    const driveAt = hours(26);
    await s.work.createAppointment(
      ctx,
      appointmentSchema.parse({
        leadId: olivia.id,
        vehicleId: vehicle(0),
        salespersonId: rep?.id ?? owner.id,
        type: 'TEST_DRIVE',
        startsAt: driveAt,
        endsAt: new Date(new Date(driveAt).getTime() + 3_600_000).toISOString(),
        location: 'Showroom',
      }),
    );

    const liam = await lead({
      firstName: 'Liam',
      lastName: 'Patel',
      email: 'liam.patel@example.test',
      province: 'BC',
      sourceId: sources.get('AUTOTRADER'),
      vehicleId: vehicle(1),
      tradeInInterest: true,
      tradeInVehicle: '2016 Mazda 3',
      assignedToId: owner.id,
    });
    await s.work.createTask(
      ctx,
      taskSchema.parse({
        title: 'Send trade-in estimate',
        leadId: liam.id,
        assignedToId: owner.id,
        dueAt: hours(-20),
        priority: 'HIGH',
      }),
    );

    const sofia = await lead({
      firstName: 'Sofia',
      lastName: 'Rossi',
      phone: '604-555-0127',
      sourceId: sources.get('WALK_IN'),
      vehicleId: vehicle(2),
      assignedToId: rep?.id ?? owner.id,
      consent: { type: 'IMPLIED_INQUIRY', source: 'Asked about a vehicle in person' },
    });
    await s.leads.logActivity(
      ctx,
      sofia.id,
      activitySchema.parse({
        type: 'MEETING',
        title: 'Walk-around and test drive',
        outcome: 'Liked it, comparing prices',
      }),
    );
    await s.leads.changeStatus(ctx, sofia.id, {
      statusId: status('NEGOTIATION'),
      lostReason: null,
    });

    const noah = await lead({
      firstName: 'Noah',
      lastName: 'Tremblay',
      email: 'noah.tremblay@example.test',
      sourceId: sources.get('GOOGLE'),
      assignedToId: owner.id,
    });
    await s.leads.changeStatus(ctx, noah.id, {
      statusId: status('LOST'),
      lostReason: 'Bought elsewhere',
    });

    await lead({
      firstName: 'Emma',
      lastName: 'Wilson',
      email: 'emma.wilson@example.test',
      phone: '604-555-0164',
      sourceId: sources.get('FACEBOOK'),
      notes: 'Asked whether the price includes winter tires.',
    });

    // Support: a buyer's ticket with a public reply and an internal note.
    let ticketNote = 'no buyer or admin to open a ticket';
    let ticketId: string | null = null;
    if (buyer && admin) {
      const requester: AuthUser = {
        id: buyer.id,
        email: buyer.email,
        firstName: buyer.firstName,
        lastName: buyer.lastName,
        role: buyer.role as UserRole,
        status: buyer.status,
        emailVerified: buyer.emailVerified,
        dealerId: null,
      };
      const ticket = await s.tickets.createFromPortal(requester, {
        subject: 'Saved search alerts stopped arriving',
        description: 'I used to get an email when new SUVs were listed, but nothing for a week.',
        categoryId: null,
      });
      const agent = { id: admin.id, email: admin.email };
      await s.tickets.addMessage(agent, ticket.id, {
        body: 'Checked the mail log: alerts were suppressed after a soft bounce. Cleared it.',
        visibility: 'INTERNAL',
      });
      await s.tickets.addMessage(agent, ticket.id, {
        body: 'Thanks for letting us know — alerts are flowing again. Could you confirm you get the next one?',
        visibility: 'PUBLIC',
      });
      ticketNote = `ticket #${ticket.number}`;
      ticketId = ticket.id;
    }

    const ava = await lead({
      firstName: 'Ava',
      lastName: 'Nguyen',
      email: LAST_LEAD_EMAIL,
      sourceId: sources.get('REFERRAL'),
      assignedToId: owner.id,
      consent: {
        type: 'EXPRESS',
        source: 'Referral sign-up card',
        evidence: 'Signed card on file',
      },
    });
    await s.leads.changeStatus(ctx, ava.id, { statusId: status('WON'), lostReason: null });

    const cancelled = await prisma.crmEmail.updateMany({
      where: {
        createdAt: { gte: startedAt },
        status: { in: ['QUEUED', 'SCHEDULED'] },
        OR: [{ leadId: { in: seeded } }, ...(ticketId ? [{ ticketId }] : [])],
      },
      data: { status: 'CANCELLED', lastError: 'Demo seed: not sent' },
    });
    const count = await prisma.crmLead.count({
      where: { dealerId: dealer.id, mergedIntoId: null },
    });
    return `${count} leads, ${ticketNote}, ${cancelled.count} seed emails cancelled (never sent)`;
  } finally {
    await prisma.$disconnect();
  }
}
