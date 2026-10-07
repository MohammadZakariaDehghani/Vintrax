import { z } from 'zod';
import {
  ADMIN_TASK_TYPES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  AUTOMATION_STEP_TYPES,
  CAMPAIGN_TYPES,
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  CONSENT_TYPES,
  CRM_ACTIVITY_TYPES,
  CRM_NOTIFICATION_EVENTS,
  CRM_PRIORITIES,
  CRM_RANGE_PRESETS,
  CRM_RECURRENCES,
  CRM_TASK_STATUSES,
  EMAIL_PURPOSES,
  LEAD_STATUS_KINDS,
  LEAD_TEMPERATURES,
  SCORE_SIGNALS,
  STOP_CONDITIONS,
  TEMPLATE_CATEGORIES,
  TICKET_STATUSES,
  TICKET_VISIBILITIES,
} from './crm';
import { PROVINCES } from './domain';
import { PREFERRED_CONTACTS } from './finance';

/**
 * Inputs to the CRM APIs (D-066). Every one is parsed on the server; the web
 * app uses the same schemas for its forms, so a message shown beside a field
 * is the message the API would give.
 */

const id = () => z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => z.string().trim().min(1, 'Required').max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));
const optionalId = () =>
  z
    .union([z.literal(''), z.string().uuid()])
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));
const optionalEmail = () =>
  z
    .union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email').max(254)])
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));
const optionalDateTime = () =>
  z
    .union([z.literal(''), z.string().datetime({ offset: true })])
    .optional()
    .nullable()
    .transform((value) => (value ? new Date(value) : null));
const dateTime = () => z.string().datetime({ offset: true }).transform((value) => new Date(value));
const flag = () =>
  z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((value) => value === true || value === 'true');

/** Whole dollars or dollars and cents → integer cents; empty → null. */
const optionalMoney = () =>
  z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((value, ctx) => {
      if (value === undefined || value === null || String(value).trim() === '') return null;
      const cleaned = String(value).replace(/[$,\s]/g, '');
      if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter an amount like 25000' });
        return z.NEVER;
      }
      return Math.round(Number(cleaned) * 100);
    });

const phone = () =>
  z
    .string()
    .trim()
    .max(30)
    .optional()
    .nullable()
    .refine((value) => !value || /^[+()\d\s.-]{7,30}$/.test(value), 'Enter a valid phone number')
    .transform((value) => (value ? value : null));

/** A key the dealer makes up for a status, source or template: UPPER_SNAKE. */
const configKey = () =>
  z
    .string()
    .trim()
    .max(40)
    .transform((value) =>
      value
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, ''),
    )
    .refine((value) => value.length > 0, 'Required');

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

// --- Ranges --------------------------------------------------------------------------

export const crmRangeQuerySchema = z
  .object({
    preset: z.enum(CRM_RANGE_PRESETS).default('THIS_MONTH'),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .refine((value) => value.preset !== 'CUSTOM' || (value.from && value.to), {
    message: 'A custom range needs a start and an end date',
    path: ['from'],
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'The start date must be on or before the end date',
    path: ['to'],
  });
export type CrmRangeQuery = z.infer<typeof crmRangeQuerySchema>;

// --- Leads ------------------------------------------------------------------------------

export const leadConsentInputSchema = z.object({
  type: z.enum(CONSENT_TYPES),
  source: requiredText(120),
  evidence: optionalText(2000),
});

export const leadSchema = z
  .object({
    firstName: requiredText(80),
    lastName: optionalText(80),
    email: optionalEmail(),
    phone: phone(),
    preferredContact: z.enum(PREFERRED_CONTACTS).optional().nullable().default(null),
    address: optionalText(200),
    city: optionalText(80),
    province: z.enum(PROVINCES).optional().nullable().default(null),
    postalCode: optionalText(10),
    sourceId: optionalId(),
    campaign: optionalText(120),
    vehicleId: optionalId(),
    interestedVin: optionalText(17),
    vehicleUrl: z
      .union([z.literal(''), z.string().trim().url('Enter a full link, starting https://').max(500)])
      .optional()
      .nullable()
      .transform((value) => (value ? value : null)),
    budget: optionalMoney(),
    financingInterest: flag(),
    tradeInInterest: flag(),
    tradeInVehicle: optionalText(160),
    preferredAppointmentAt: optionalDateTime(),
    notes: optionalText(5000),
    statusId: optionalId(),
    assignedToId: optionalId(),
    team: optionalText(60),
    nextFollowUpAt: optionalDateTime(),
    tags: z.array(text(40)).max(30).optional().default([]),
    /** Record consent at creation, with where it came from. */
    consent: leadConsentInputSchema.optional().nullable(),
  })
  .refine((value) => value.email || value.phone, {
    message: 'Enter an email address or a phone number',
    path: ['email'],
  });
export type LeadInput = z.infer<typeof leadSchema>;

export const LEAD_VIEWS = [
  'ALL',
  'NEW',
  'UNCONTACTED',
  'FOLLOW_UP_TODAY',
  'OVERDUE',
  'HOT',
  'MINE',
  'UNASSIGNED',
  'WON',
  'LOST',
] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];

export const LEAD_SORTS = ['newest', 'oldest', 'score', 'next_follow_up', 'last_activity'] as const;

export const leadListQuerySchema = z.object({
  q: text(100).optional(),
  view: z.enum(LEAD_VIEWS).default('ALL'),
  statusId: optionalId(),
  sourceId: optionalId(),
  assignedToId: z.union([z.literal('unassigned'), z.string().uuid()]).optional(),
  temperature: z.enum(LEAD_TEMPERATURES).optional(),
  tag: text(40).optional(),
  province: z.enum(PROVINCES).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sort: z.enum(LEAD_SORTS).default('newest'),
  ...pageQuery,
});
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

export const leadStatusChangeSchema = z
  .object({
    statusId: id(),
    lostReason: optionalText(300),
  })
  .strict();
export type LeadStatusChangeInput = z.infer<typeof leadStatusChangeSchema>;

export const leadAssignSchema = z.object({
  assignedToId: optionalId(),
  team: optionalText(60),
});
export type LeadAssignInput = z.infer<typeof leadAssignSchema>;

export const leadTagsSchema = z.object({ tags: z.array(requiredText(40)).max(30) });

export const leadMergeSchema = z.object({
  /** The duplicate: its history moves to the lead in the URL, then it is hidden. */
  duplicateId: id(),
});

export const leadBulkSchema = z.object({
  leadIds: z.array(id()).min(1).max(500),
  action: z.enum(['ASSIGN', 'SET_STATUS', 'ADD_TAG', 'DELETE']),
  assignedToId: optionalId(),
  statusId: optionalId(),
  tag: optionalText(40),
});
export type LeadBulkInput = z.infer<typeof leadBulkSchema>;

// --- Activities, tasks, appointments ----------------------------------------------

export const activitySchema = z.object({
  type: z.enum(CRM_ACTIVITY_TYPES),
  title: requiredText(160),
  notes: optionalText(5000),
  occurredAt: optionalDateTime(),
  status: optionalText(40),
  outcome: optionalText(160),
  nextAction: optionalText(160),
  vehicleId: optionalId(),
  /** Sets the lead's next follow-up at the same time. */
  nextFollowUpAt: optionalDateTime(),
});
export type ActivityInput = z.infer<typeof activitySchema>;

export const timelineQuerySchema = z.object({
  type: text(40).optional(),
  cursor: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const taskSchema = z
  .object({
    title: requiredText(160),
    description: optionalText(5000),
    leadId: optionalId(),
    assignedToId: optionalId(),
    vehicleId: optionalId(),
    dueAt: optionalDateTime(),
    priority: z.enum(CRM_PRIORITIES).default('MEDIUM'),
    status: z.enum(CRM_TASK_STATUSES).default('OPEN'),
    reminderAt: optionalDateTime(),
    recurrence: z.enum(CRM_RECURRENCES).default('NONE'),
  })
  .refine((value) => value.recurrence === 'NONE' || value.dueAt, {
    message: 'A repeating task needs a due date',
    path: ['dueAt'],
  })
  .refine((value) => !value.reminderAt || !value.dueAt || value.reminderAt <= value.dueAt, {
    message: 'The reminder must be before the due date',
    path: ['reminderAt'],
  });
export type TaskInput = z.infer<typeof taskSchema>;

export const taskStatusSchema = z.object({ status: z.enum(CRM_TASK_STATUSES) });

export const taskListQuerySchema = z.object({
  view: z.enum(['OPEN', 'TODAY', 'OVERDUE', 'UPCOMING', 'COMPLETED', 'ALL']).default('OPEN'),
  assignedToId: z.union([z.literal('me'), z.literal('unassigned'), z.string().uuid()]).optional(),
  leadId: optionalId(),
  priority: z.enum(CRM_PRIORITIES).optional(),
  ...pageQuery,
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export const appointmentSchema = z
  .object({
    leadId: id(),
    vehicleId: optionalId(),
    salespersonId: optionalId(),
    type: z.enum(APPOINTMENT_TYPES),
    startsAt: dateTime(),
    endsAt: dateTime(),
    location: optionalText(200),
    notes: optionalText(2000),
    status: z.enum(APPOINTMENT_STATUSES).default('SCHEDULED'),
    reminderMinutes: z.coerce.number().int().min(0).max(10_080).nullable().default(60),
  })
  .refine((value) => value.endsAt > value.startsAt, {
    message: 'The end must be after the start',
    path: ['endsAt'],
  });
export type AppointmentInput = z.infer<typeof appointmentSchema>;

export const appointmentStatusSchema = z.object({ status: z.enum(APPOINTMENT_STATUSES) });

export const calendarQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  salespersonId: optionalId(),
});

// --- Configuration -----------------------------------------------------------------------

export const leadStatusConfigSchema = z.object({
  key: configKey().optional(),
  label: requiredText(40),
  kind: z.enum(LEAD_STATUS_KINDS),
  inPipeline: z.boolean().default(true),
  isActive: z.boolean().default(true),
});
export type LeadStatusConfigInput = z.infer<typeof leadStatusConfigSchema>;

export const leadStatusOrderSchema = z.object({ ids: z.array(id()).min(1).max(50) });

export const leadSourceSchema = z.object({
  key: configKey().optional(),
  label: requiredText(60),
  monthlyCost: optionalMoney(),
  isActive: z.boolean().default(true),
});
export type LeadSourceInput = z.infer<typeof leadSourceSchema>;

export const tagSchema = z.object({
  name: requiredText(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2563eb')
    .optional()
    .nullable()
    .default(null),
});
export type TagInput = z.infer<typeof tagSchema>;

export const scoringSchema = z
  .object({
    rules: z
      .array(
        z.object({
          signal: z.enum(SCORE_SIGNALS),
          points: z.coerce.number().int().min(-100).max(100),
          isActive: z.boolean().default(true),
        }),
      )
      .max(SCORE_SIGNALS.length),
    hotThreshold: z.coerce.number().int().min(1).max(1000),
    warmThreshold: z.coerce.number().int().min(0).max(1000),
  })
  .refine((value) => value.warmThreshold < value.hotThreshold, {
    message: 'Warm must be below hot',
    path: ['warmThreshold'],
  });
export type ScoringInput = z.infer<typeof scoringSchema>;

export const ASSIGNMENT_MODES = ['MANUAL', 'ROUND_ROBIN', 'RULES'] as const;
export const ASSIGNMENT_MATCH_FIELDS = ['ANY', 'SOURCE', 'VEHICLE_MAKE', 'PROVINCE'] as const;

export const assignmentRuleSchema = z
  .object({
    matchField: z.enum(ASSIGNMENT_MATCH_FIELDS),
    matchValue: optionalText(60),
    assignToUserId: optionalId(),
    assignToTeam: optionalText(60),
    isActive: z.boolean().default(true),
  })
  .refine((value) => value.assignToUserId || value.assignToTeam, {
    message: 'Choose a salesperson or a team',
    path: ['assignToUserId'],
  })
  .refine((value) => value.matchField === 'ANY' || value.matchValue, {
    message: 'Enter the value to match',
    path: ['matchValue'],
  });
export type AssignmentRuleInput = z.infer<typeof assignmentRuleSchema>;

export const teamMemberSchema = z.object({
  userId: id(),
  team: requiredText(60),
});

const hour = () => z.coerce.number().int().min(0).max(24);

export const crmSettingsSchema = z
  .object({
    timezone: requiredText(60).refine((zone) => {
      try {
        new Intl.DateTimeFormat('en-CA', { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown time zone'),
    sendWindowStartHour: hour(),
    sendWindowEndHour: hour(),
    sendDays: z.array(z.coerce.number().int().min(0).max(6)).min(1).max(7),
    responseTargetMinutes: z.coerce.number().int().min(1).max(10_080),
    noResponseDays: z.coerce.number().int().min(1).max(90),
    inactiveDays: z.coerce.number().int().min(1).max(730),
    assignmentMode: z.enum(ASSIGNMENT_MODES),
    createFollowUpTask: z.boolean(),
    senderName: optionalText(80),
    replyToEmail: optionalEmail(),
    businessAddress: optionalText(300),
    businessPhone: phone(),
    businessEmail: optionalEmail(),
    impliedConsentFromInquiry: z.boolean(),
    impliedConsentFromPurchase: z.boolean(),
    postSaleEnabled: z.boolean(),
  })
  .refine((value) => value.sendWindowStartHour < value.sendWindowEndHour, {
    message: 'The window must end after it starts',
    path: ['sendWindowEndHour'],
  });
export type CrmSettingsInput = z.infer<typeof crmSettingsSchema>;

export const notificationPrefsSchema = z.object({
  preferences: z
    .array(
      z.object({
        event: z.enum(CRM_NOTIFICATION_EVENTS),
        inApp: z.boolean(),
        email: z.boolean(),
      }),
    )
    .max(CRM_NOTIFICATION_EVENTS.length),
});
export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>;

// --- Import ------------------------------------------------------------------------------

/** Lead fields a CSV column can map to. */
export const LEAD_IMPORT_FIELDS = [
  'firstName',
  'lastName',
  'fullName',
  'email',
  'phone',
  'city',
  'province',
  'postalCode',
  'source',
  'campaign',
  'vin',
  'budget',
  'notes',
  'tags',
  'status',
] as const;
export type LeadImportField = (typeof LEAD_IMPORT_FIELDS)[number];

export const leadImportSchema = z.object({
  fileName: requiredText(200),
  /** The CSV text. 2 MB is ~10,000 rows of lead data. */
  csv: z.string().min(1).max(2_000_000),
  /** CSV header → lead field. Unmapped columns are ignored. */
  mapping: z.record(z.string().max(100), z.enum(LEAD_IMPORT_FIELDS)),
  /** What to do with a row matching an existing lead by email or phone. */
  duplicates: z.enum(['SKIP', 'CREATE']).default('SKIP'),
  /** Consent the rows come with. None by default: an imported list is not consent. */
  consent: leadConsentInputSchema.optional().nullable(),
  defaultSourceId: optionalId(),
});
export type LeadImportInput = z.infer<typeof leadImportSchema>;

// --- Email ---------------------------------------------------------------------------------

export const emailTemplateSchema = z.object({
  name: requiredText(120),
  category: z.enum(TEMPLATE_CATEGORIES),
  purpose: z.enum(EMAIL_PURPOSES),
  subject: requiredText(200),
  bodyHtml: requiredText(100_000),
  bodyText: optionalText(100_000),
  isActive: z.boolean().default(true),
});
export type EmailTemplateInput = z.infer<typeof emailTemplateSchema>;

export const emailPreviewSchema = z.object({
  subject: requiredText(200),
  bodyHtml: requiredText(100_000),
  leadId: optionalId(),
  ticketId: optionalId(),
});
export type EmailPreviewInput = z.infer<typeof emailPreviewSchema>;

export const emailComposeSchema = z.object({
  leadId: id(),
  templateId: optionalId(),
  subject: requiredText(200),
  bodyHtml: requiredText(100_000),
  purpose: z.enum(EMAIL_PURPOSES).default('TRANSACTIONAL'),
  /** Send later; otherwise now. */
  scheduledAt: optionalDateTime(),
  /** Hold until the dealer's send window opens. */
  respectSendWindow: z.boolean().default(false),
});
export type EmailComposeInput = z.infer<typeof emailComposeSchema>;

export const testEmailSchema = z.object({
  subject: requiredText(200),
  bodyHtml: requiredText(100_000),
  to: z.string().trim().toLowerCase().email().max(254),
});

export const emailListQuerySchema = z.object({
  status: z
    .enum([
      'SCHEDULED',
      'QUEUED',
      'SENDING',
      'SENT',
      'DELIVERED',
      'FAILED',
      'BOUNCED',
      'SUPPRESSED',
      'CANCELLED',
    ])
    .optional(),
  purpose: z.enum(EMAIL_PURPOSES).optional(),
  leadId: optionalId(),
  campaignId: optionalId(),
  q: text(100).optional(),
  ...pageQuery,
});
export type EmailListQuery = z.infer<typeof emailListQuerySchema>;

export const consentSchema = z.object({
  leadId: id(),
  type: z.enum(CONSENT_TYPES),
  source: requiredText(120),
  evidence: optionalText(2000),
});
export type ConsentInput = z.infer<typeof consentSchema>;

export const suppressionSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  note: optionalText(300),
});

// --- Campaigns ----------------------------------------------------------------------------

export const campaignAudienceSchema = z.object({
  statusIds: z.array(id()).max(50).default([]),
  sourceIds: z.array(id()).max(50).default([]),
  tags: z.array(text(40)).max(30).default([]),
  provinces: z.array(z.enum(PROVINCES)).max(13).default([]),
  temperatures: z.array(z.enum(LEAD_TEMPERATURES)).max(3).default([]),
  makes: z.array(text(40)).max(30).default([]),
  minBudget: optionalMoney(),
  maxBudget: optionalMoney(),
  /** Only leads that have become customers, or only those that have not. */
  customers: z.enum(['ANY', 'ONLY', 'EXCLUDE']).default('ANY'),
  activeAfter: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  inactiveSince: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
});
export type CampaignAudience = z.infer<typeof campaignAudienceSchema>;

export const campaignSchema = z.object({
  name: requiredText(120),
  type: z.enum(CAMPAIGN_TYPES),
  templateId: id(),
  subject: optionalText(200),
  audience: campaignAudienceSchema,
  scheduledAt: optionalDateTime(),
  cost: optionalMoney(),
});
export type CampaignInput = z.infer<typeof campaignSchema>;

// --- Automations ----------------------------------------------------------------------------

export const conditionSchema = z.object({
  field: z.enum(CONDITION_FIELDS),
  op: z.enum(CONDITION_OPERATORS),
  value: z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.string().max(100)).max(50)]).optional(),
});
export type AutomationCondition = z.infer<typeof conditionSchema>;

/**
 * One step. `next` is the step after it; a CONDITION step goes to `yes` or
 * `no` instead. A missing `next` ends the automation.
 */
export const automationStepSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, - and _'),
  type: z.enum(AUTOMATION_STEP_TYPES),
  next: z.string().max(40).optional().nullable(),
  yes: z.string().max(40).optional().nullable(),
  no: z.string().max(40).optional().nullable(),
  config: z
    .object({
      /** WAIT */
      minutes: z.coerce.number().int().min(0).max(525_600).optional(),
      /** CONDITION: all must hold. */
      conditions: z.array(conditionSchema).max(10).optional(),
      /** SEND_EMAIL */
      templateKey: z.string().max(80).optional(),
      templateId: z.string().uuid().optional(),
      /** SEND_EMAIL to the salesperson rather than the customer. */
      toSalesperson: z.boolean().optional(),
      /** CREATE_TASK, NOTIFY */
      title: z.string().max(160).optional(),
      body: z.string().max(1000).optional(),
      dueInMinutes: z.coerce.number().int().min(0).max(525_600).optional(),
      priority: z.enum(CRM_PRIORITIES).optional(),
      /** ASSIGN: a user, a team, or round-robin when both are empty. */
      userId: z.string().uuid().optional(),
      team: z.string().max(60).optional(),
      /** SET_STATUS */
      statusKey: z.string().max(40).optional(),
      /** ADD_TAG, REMOVE_TAG */
      tag: z.string().max(40).optional(),
      /** START_AUTOMATION */
      automationKey: z.string().max(80).optional(),
      automationId: z.string().uuid().optional(),
      /** NOTIFY: ASSIGNEE, MANAGERS (dealer) or TEAM (support). */
      recipients: z.enum(['ASSIGNEE', 'MANAGERS', 'TEAM']).optional(),
      /** Support: set the ticket's status. */
      ticketStatus: z.enum(TICKET_STATUSES).optional(),
    })
    .default({}),
});
export type AutomationStep = z.infer<typeof automationStepSchema>;

export const automationSchema = z
  .object({
    name: requiredText(120),
    description: optionalText(500),
    trigger: requiredText(40),
    triggerConfig: z
      .object({
        /** NO_RESPONSE, CUSTOMER_INACTIVE, TICKET_WAITING: days. */
        days: z.coerce.number().int().min(1).max(730).optional(),
        /** LEAD_STATUS_CHANGED: only into this status. */
        statusKey: z.string().max(40).optional(),
        conditions: z.array(conditionSchema).max(10).optional(),
      })
      .default({}),
    steps: z.array(automationStepSchema).min(1).max(50),
    stopConditions: z.array(z.enum(STOP_CONDITIONS)).max(STOP_CONDITIONS.length).default([]),
    respectSendWindow: z.boolean().default(true),
    isActive: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    value.steps.forEach((step, index) => {
      if (ids.has(step.id)) {
        ctx.addIssue({ code: 'custom', message: `Step id "${step.id}" is used twice`, path: ['steps', index, 'id'] });
      }
      ids.add(step.id);
    });
    value.steps.forEach((step, index) => {
      for (const key of ['next', 'yes', 'no'] as const) {
        const target = step[key];
        if (target && !ids.has(target)) {
          ctx.addIssue({ code: 'custom', message: `Step "${step.id}" points at a step that does not exist`, path: ['steps', index, key] });
        }
      }
      const config = step.config;
      if (step.type === 'WAIT' && !(config.minutes && config.minutes > 0)) {
        ctx.addIssue({ code: 'custom', message: 'A wait needs a length', path: ['steps', index, 'config', 'minutes'] });
      }
      if (step.type === 'CONDITION' && !config.conditions?.length) {
        ctx.addIssue({ code: 'custom', message: 'A condition needs at least one rule', path: ['steps', index, 'config', 'conditions'] });
      }
      if (step.type === 'SEND_EMAIL' && !config.templateKey && !config.templateId) {
        ctx.addIssue({ code: 'custom', message: 'Choose a template', path: ['steps', index, 'config', 'templateId'] });
      }
      if ((step.type === 'CREATE_TASK' || step.type === 'NOTIFY') && !config.title) {
        ctx.addIssue({ code: 'custom', message: 'Enter a title', path: ['steps', index, 'config', 'title'] });
      }
      if ((step.type === 'ADD_TAG' || step.type === 'REMOVE_TAG') && !config.tag) {
        ctx.addIssue({ code: 'custom', message: 'Enter a tag', path: ['steps', index, 'config', 'tag'] });
      }
      if (step.type === 'SET_STATUS' && !config.statusKey && !config.ticketStatus) {
        ctx.addIssue({ code: 'custom', message: 'Choose a status', path: ['steps', index, 'config', 'statusKey'] });
      }
      if (step.type === 'START_AUTOMATION' && !config.automationKey && !config.automationId) {
        ctx.addIssue({ code: 'custom', message: 'Choose an automation', path: ['steps', index, 'config', 'automationId'] });
      }
    });
    // No loops: a sequence that can revisit a step could email someone forever.
    const byId = new Map(value.steps.map((step) => [step.id, step]));
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (stepId: string): boolean => {
      if (state.get(stepId) === 'done') return false;
      if (state.get(stepId) === 'visiting') return true;
      state.set(stepId, 'visiting');
      const step = byId.get(stepId);
      const targets = step ? [step.next, step.yes, step.no].filter((t): t is string => !!t && byId.has(t)) : [];
      const cyclic = targets.some(visit);
      state.set(stepId, 'done');
      return cyclic;
    };
    if (value.steps.some((step) => visit(step.id))) {
      ctx.addIssue({ code: 'custom', message: 'The steps loop back on themselves', path: ['steps'] });
    }
  });
export type AutomationInput = z.infer<typeof automationSchema>;

export const automationEnrollSchema = z.object({
  leadId: optionalId(),
  ticketId: optionalId(),
});

// --- Admin support CRM ------------------------------------------------------------------

export const ticketSchema = z.object({
  requesterId: optionalId(),
  requesterEmail: z.string().trim().toLowerCase().email().max(254),
  requesterName: optionalText(120),
  dealerId: optionalId(),
  subject: requiredText(200),
  description: requiredText(20_000),
  categoryId: optionalId(),
  priority: z.enum(CRM_PRIORITIES).default('MEDIUM'),
  assignedToId: optionalId(),
  teamId: optionalId(),
  dueAt: optionalDateTime(),
  tags: z.array(text(40)).max(20).default([]),
});
export type TicketInput = z.infer<typeof ticketSchema>;

export const ticketUpdateSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(CRM_PRIORITIES).optional(),
    categoryId: optionalId().optional(),
    assignedToId: z.union([z.literal(''), z.string().uuid()]).nullable().optional(),
    teamId: z.union([z.literal(''), z.string().uuid()]).nullable().optional(),
    dueAt: z.union([z.literal(''), z.string().datetime({ offset: true })]).nullable().optional(),
    resolution: z.string().trim().max(5000).optional(),
    tags: z.array(text(40)).max(20).optional(),
  })
  .strict();
export type TicketUpdateInput = z.infer<typeof ticketUpdateSchema>;

export const ticketMessageSchema = z.object({
  body: requiredText(20_000),
  visibility: z.enum(TICKET_VISIBILITIES),
  /** For a public reply: the status to leave the ticket in. */
  status: z.enum(TICKET_STATUSES).optional(),
});
export type TicketMessageInput = z.infer<typeof ticketMessageSchema>;

export const ticketListQuerySchema = z.object({
  q: text(100).optional(),
  view: z.enum(['OPEN', 'MINE', 'UNASSIGNED', 'OVERDUE', 'WAITING', 'ESCALATED', 'RESOLVED', 'ALL']).default('OPEN'),
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(CRM_PRIORITIES).optional(),
  categoryId: optionalId(),
  dealerId: optionalId(),
  requesterId: optionalId(),
  ...pageQuery,
});
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;

/** A user or dealer opening a ticket from their account. */
export const portalTicketSchema = z.object({
  subject: requiredText(200),
  description: requiredText(20_000),
  categoryId: optionalId(),
});
export type PortalTicketInput = z.infer<typeof portalTicketSchema>;

export const portalReplySchema = z.object({ body: requiredText(20_000) });

export const adminTaskSchema = z.object({
  type: z.enum(ADMIN_TASK_TYPES).default('OTHER'),
  title: requiredText(160),
  description: optionalText(5000),
  assignedToId: optionalId(),
  ticketId: optionalId(),
  dealerId: optionalId(),
  subjectUserId: optionalId(),
  dueAt: optionalDateTime(),
  reminderAt: optionalDateTime(),
  priority: z.enum(CRM_PRIORITIES).default('MEDIUM'),
  status: z.enum(CRM_TASK_STATUSES).default('OPEN'),
});
export type AdminTaskInput = z.infer<typeof adminTaskSchema>;

export const adminTaskListQuerySchema = z.object({
  view: z.enum(['OPEN', 'MINE', 'OVERDUE', 'COMPLETED', 'ALL']).default('OPEN'),
  ticketId: optionalId(),
  dealerId: optionalId(),
  subjectUserId: optionalId(),
  ...pageQuery,
});

export const supportCategorySchema = z.object({
  key: configKey().optional(),
  label: requiredText(60),
  isActive: z.boolean().default(true),
});

export const supportTeamSchema = z.object({
  name: requiredText(60),
  memberIds: z.array(id()).max(100),
  isActive: z.boolean().default(true),
});

const hoursByPriority = z.object({
  URGENT: z.coerce.number().min(0.25).max(2000),
  HIGH: z.coerce.number().min(0.25).max(2000),
  MEDIUM: z.coerce.number().min(0.25).max(2000),
  LOW: z.coerce.number().min(0.25).max(2000),
});

export const supportSettingsSchema = z.object({
  firstResponseHours: hoursByPriority,
  resolutionHours: hoursByPriority,
  waitingReminderDays: z.coerce.number().int().min(1).max(60),
  autoCloseDays: z.coerce.number().int().min(1).max(90),
  defaultTeamId: optionalId(),
});
export type SupportSettingsInput = z.infer<typeof supportSettingsSchema>;

export const directMessageSchema = z.object({
  /** A user (by account) or a dealer (its owner). */
  userId: optionalId(),
  dealerId: optionalId(),
  subject: requiredText(200),
  body: requiredText(20_000),
  channels: z.array(z.enum(['EMAIL', 'IN_APP'])).min(1).max(2),
  ticketId: optionalId(),
});
export type DirectMessageInput = z.infer<typeof directMessageSchema>;
