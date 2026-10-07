/**
 * CRM domain vocabulary shared by the API and the web app (D-066).
 *
 * Two CRMs on one infrastructure: the Dealer CRM (leads, follow-up, email
 * automation, the purchase journey) and the Admin support CRM (tickets for
 * Vintrax's own users and dealers). They share email, automation, tags and
 * the timeline, never their data.
 */

import type { DealerStaffRole } from './accounting';

// --- Dealer CRM permissions --------------------------------------------------------

export const CRM_PERMISSIONS = [
  /** Open the CRM and work the leads assigned to you (or unassigned). */
  'crm.view',
  /** See every lead of the dealership, not only your own. */
  'crm.all_leads',
  /** Work leads: create and edit them, log activities, change status, tasks and appointments. */
  'crm.work',
  /** Edit, assign, merge, import and delete any lead. */
  'crm.manage',
  /** Send individual emails from a lead. */
  'crm.email',
  /** Marketing campaigns. */
  'crm.marketing',
  /** Automations (follow-up sequences). */
  'crm.automations',
  /** Email templates. */
  'crm.templates',
  /** CRM reports. */
  'crm.reports',
  /** Statuses, sources, scoring, business hours, consent and sender settings. */
  'crm.settings',
] as const;
export type CrmPermission = (typeof CRM_PERMISSIONS)[number];

export const CRM_ROLE_PERMISSIONS: Record<DealerStaffRole, readonly CrmPermission[]> = {
  OWNER: CRM_PERMISSIONS,
  MANAGER: CRM_PERMISSIONS,
  SALES_MANAGER: CRM_PERMISSIONS.filter((permission) => permission !== 'crm.settings'),
  SALES_USER: ['crm.view', 'crm.work', 'crm.email'],
  // The books, not the sales floor: reads leads and reports, changes nothing.
  ACCOUNTANT: ['crm.view', 'crm.all_leads', 'crm.reports'],
};

// --- Leads -------------------------------------------------------------------------

/** What a status means to the engine; the label is the dealer's own. */
export const LEAD_STATUS_KINDS = ['OPEN', 'WON', 'LOST', 'NURTURE', 'UNRESPONSIVE'] as const;
export type LeadStatusKind = (typeof LEAD_STATUS_KINDS)[number];

export const DEFAULT_LEAD_STATUSES: ReadonlyArray<{
  key: string;
  label: string;
  kind: LeadStatusKind;
}> = [
  { key: 'NEW', label: 'New', kind: 'OPEN' },
  { key: 'CONTACTED', label: 'Contacted', kind: 'OPEN' },
  { key: 'ENGAGED', label: 'Engaged', kind: 'OPEN' },
  { key: 'QUALIFIED', label: 'Qualified', kind: 'OPEN' },
  { key: 'APPOINTMENT_SET', label: 'Appointment Set', kind: 'OPEN' },
  { key: 'TEST_DRIVE', label: 'Test Drive', kind: 'OPEN' },
  { key: 'NEGOTIATION', label: 'Negotiation', kind: 'OPEN' },
  { key: 'FINANCE', label: 'Finance', kind: 'OPEN' },
  { key: 'WON', label: 'Won', kind: 'WON' },
  { key: 'LOST', label: 'Lost', kind: 'LOST' },
  { key: 'UNRESPONSIVE', label: 'Unresponsive', kind: 'UNRESPONSIVE' },
  { key: 'NURTURE', label: 'Nurture', kind: 'NURTURE' },
];

export const DEFAULT_LEAD_SOURCES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'VINTRAX_WEBSITE', label: 'Vintrax Website' },
  { key: 'VEHICLE_DETAIL_PAGE', label: 'Vehicle Detail Page' },
  { key: 'CONTACT_FORM', label: 'Contact Form' },
  { key: 'PHONE', label: 'Phone' },
  { key: 'EMAIL', label: 'Email' },
  { key: 'WALK_IN', label: 'Walk-in' },
  { key: 'REFERRAL', label: 'Referral' },
  { key: 'GOOGLE', label: 'Google' },
  { key: 'FACEBOOK', label: 'Facebook' },
  { key: 'INSTAGRAM', label: 'Instagram' },
  { key: 'AUTOTRADER', label: 'AutoTrader' },
  { key: 'OTHER_MARKETPLACE', label: 'Other Marketplace' },
  { key: 'IMPORT', label: 'Import/API' },
  { key: 'MANUAL', label: 'Manual Entry' },
];

export const LEAD_TEMPERATURES = ['HOT', 'WARM', 'COLD'] as const;
export type LeadTemperature = (typeof LEAD_TEMPERATURES)[number];

export const CONTACT_METHODS = ['PHONE', 'EMAIL', 'TEXT'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const DEFAULT_LEAD_TAGS = [
  'Hot',
  'VIP',
  'Financing',
  'Trade-in',
  'SUV',
  'Truck',
  'Budget',
  'Returning Customer',
  'High Intent',
  'Needs Follow-up',
] as const;

// --- Lead scoring -------------------------------------------------------------------

export const SCORE_SIGNALS = [
  'VEHICLE_INQUIRY',
  'EMAIL_OPENED',
  'EMAIL_CLICKED',
  'CUSTOMER_REPLIED',
  'APPOINTMENT_BOOKED',
  'TEST_DRIVE',
  'FINANCING_REQUEST',
  'TRADE_IN_SUBMITTED',
  'NO_RESPONSE',
  'LONG_INACTIVITY',
] as const;
export type ScoreSignal = (typeof SCORE_SIGNALS)[number];

/** Starting points; every dealer can change them under CRM → Settings. */
export const DEFAULT_SCORING: Record<ScoreSignal, number> = {
  VEHICLE_INQUIRY: 10,
  EMAIL_OPENED: 10,
  EMAIL_CLICKED: 20,
  CUSTOMER_REPLIED: 15,
  APPOINTMENT_BOOKED: 20,
  TEST_DRIVE: 30,
  FINANCING_REQUEST: 20,
  TRADE_IN_SUBMITTED: 15,
  NO_RESPONSE: -10,
  LONG_INACTIVITY: -20,
};

export const SCORE_SIGNAL_LABELS: Record<ScoreSignal, string> = {
  VEHICLE_INQUIRY: 'Vehicle inquiry',
  EMAIL_OPENED: 'Email opened',
  EMAIL_CLICKED: 'Email link clicked',
  CUSTOMER_REPLIED: 'Customer replied',
  APPOINTMENT_BOOKED: 'Appointment booked',
  TEST_DRIVE: 'Test drive',
  FINANCING_REQUEST: 'Financing requested',
  TRADE_IN_SUBMITTED: 'Trade-in submitted',
  NO_RESPONSE: 'No response',
  LONG_INACTIVITY: 'Long inactivity',
};

/** A score at or above `hot` is Hot, at or above `warm` Warm, otherwise Cold. */
export function temperatureFor(
  score: number,
  thresholds: { hot: number; warm: number },
): LeadTemperature {
  if (score >= thresholds.hot) return 'HOT';
  if (score >= thresholds.warm) return 'WARM';
  return 'COLD';
}

// --- Activities and the journey --------------------------------------------------

/** Activities people log. */
export const CRM_ACTIVITY_TYPES = [
  'CALL',
  'EMAIL',
  'SMS',
  'MEETING',
  'APPOINTMENT',
  'NOTE',
  'TASK',
  'TEST_DRIVE',
  'FOLLOW_UP',
  'QUOTE',
  'FINANCE',
  'TRADE_IN',
  'OTHER',
] as const;
export type CrmActivityType = (typeof CRM_ACTIVITY_TYPES)[number];

/** Events the system records on the timeline. */
export const CRM_EVENT_TYPES = [
  'LEAD_CREATED',
  'LEAD_ASSIGNED',
  'STATUS_CHANGED',
  'FIRST_CONTACT',
  'VEHICLE_VIEWED',
  'VEHICLE_INQUIRY',
  'CUSTOMER_REPLIED',
  'EMAIL_SENT',
  'EMAIL_OPENED',
  'EMAIL_CLICKED',
  'EMAIL_BOUNCED',
  'EMAIL_FAILED',
  'UNSUBSCRIBED',
  'CONSENT_CHANGED',
  'APPOINTMENT_BOOKED',
  'APPOINTMENT_UPDATED',
  'TASK_CREATED',
  'TASK_COMPLETED',
  'TRADE_IN_APPRAISAL',
  'FINANCING_REQUESTED',
  'DEPOSIT',
  'SALE',
  'DELIVERY',
  'POST_SALE',
  'CONVERTED',
  'MERGED',
  'TAG_ADDED',
  'TAG_REMOVED',
  'SCORE_CHANGED',
  'AUTOMATION_STARTED',
  'AUTOMATION_STEP',
  'AUTOMATION_STOPPED',
] as const;
export type CrmEventType = (typeof CRM_EVENT_TYPES)[number];

export type CrmTimelineType = CrmActivityType | CrmEventType;

export const CRM_ACTIVITY_LABELS: Record<CrmActivityType, string> = {
  CALL: 'Call',
  EMAIL: 'Email',
  SMS: 'Text message',
  MEETING: 'Meeting',
  APPOINTMENT: 'Appointment',
  NOTE: 'Note',
  TASK: 'Task',
  TEST_DRIVE: 'Test drive',
  FOLLOW_UP: 'Follow-up',
  QUOTE: 'Quote',
  FINANCE: 'Finance',
  TRADE_IN: 'Trade-in',
  OTHER: 'Other',
};

/** The automotive purchase journey, in order. A lead need not pass every stage. */
export const JOURNEY_STAGES = [
  { key: 'LEAD_CREATED', label: 'Lead created', events: ['LEAD_CREATED'] },
  { key: 'ASSIGNED', label: 'Assigned', events: ['LEAD_ASSIGNED'] },
  {
    key: 'FIRST_CONTACT',
    label: 'First contact',
    events: ['FIRST_CONTACT', 'CALL', 'EMAIL_SENT', 'EMAIL'],
  },
  { key: 'INQUIRY', label: 'Vehicle inquiry', events: ['VEHICLE_INQUIRY', 'VEHICLE_VIEWED'] },
  {
    key: 'APPOINTMENT',
    label: 'Appointment',
    events: ['APPOINTMENT_BOOKED', 'APPOINTMENT', 'MEETING'],
  },
  { key: 'TEST_DRIVE', label: 'Test drive', events: ['TEST_DRIVE'] },
  { key: 'TRADE_IN', label: 'Trade-in appraisal', events: ['TRADE_IN_APPRAISAL', 'TRADE_IN'] },
  { key: 'FINANCING', label: 'Financing', events: ['FINANCING_REQUESTED', 'FINANCE'] },
  { key: 'NEGOTIATION', label: 'Negotiation', events: ['QUOTE'] },
  { key: 'DEPOSIT', label: 'Deposit', events: ['DEPOSIT'] },
  { key: 'SALE', label: 'Sale', events: ['SALE'] },
  { key: 'DELIVERY', label: 'Delivery', events: ['DELIVERY'] },
  { key: 'POST_SALE', label: 'Post-sale follow-up', events: ['POST_SALE'] },
] as const;

// --- Tasks and appointments --------------------------------------------------------

export const CRM_TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type CrmTaskStatus = (typeof CRM_TASK_STATUSES)[number];
export const CRM_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type CrmPriority = (typeof CRM_PRIORITIES)[number];
export const CRM_RECURRENCES = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type CrmRecurrence = (typeof CRM_RECURRENCES)[number];

export const APPOINTMENT_TYPES = [
  'TEST_DRIVE',
  'VEHICLE_VIEWING',
  'SALES_MEETING',
  'TRADE_IN_APPRAISAL',
  'FINANCE_MEETING',
  'DELIVERY',
  'OTHER',
] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];
export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

// --- Email -----------------------------------------------------------------------------

/**
 * Under CASL a commercial electronic message (marketing) needs consent and an
 * unsubscribe mechanism; a message that only answers or completes something
 * the person asked for is not commercial. The two are kept apart throughout.
 */
export const EMAIL_PURPOSES = ['TRANSACTIONAL', 'MARKETING'] as const;
export type EmailPurpose = (typeof EMAIL_PURPOSES)[number];

export const EMAIL_STATUSES = [
  'SCHEDULED',
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'FAILED',
  'BOUNCED',
  'SUPPRESSED',
  'CANCELLED',
] as const;
export type CrmEmailStatus = (typeof EMAIL_STATUSES)[number];

export const EMAIL_EVENT_TYPES = [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'OPENED',
  'CLICKED',
  'REPLIED',
  'BOUNCED',
  'FAILED',
  'UNSUBSCRIBED',
  'COMPLAINED',
  'SUPPRESSED',
  'CANCELLED',
  'RETRY',
] as const;
export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number];

export const SUPPRESSION_REASONS = [
  'UNSUBSCRIBED',
  'HARD_BOUNCE',
  'INVALID',
  'COMPLAINT',
  'MANUAL',
] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

/** Suppressions that stop every email, not only marketing. */
export const HARD_SUPPRESSIONS: readonly SuppressionReason[] = [
  'HARD_BOUNCE',
  'INVALID',
  'COMPLAINT',
  'MANUAL',
];

/**
 * Consent kinds under CASL (S.C. 2010, c. 23, s. 10). Express consent does
 * not expire until withdrawn. Implied consent from an inquiry lasts six
 * months, and from a purchase (an existing business relationship) two years.
 * Source: Government of Canada, fightspam.gc.ca and CRTC guidance. Not legal
 * advice — dealers should confirm their practices.
 */
export const CONSENT_TYPES = ['EXPRESS', 'IMPLIED_INQUIRY', 'IMPLIED_PURCHASE'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const CONSENT_DURATION_DAYS: Record<ConsentType, number | null> = {
  EXPRESS: null,
  IMPLIED_INQUIRY: 183,
  IMPLIED_PURCHASE: 730,
};

export const CONSENT_TYPE_LABELS: Record<ConsentType, string> = {
  EXPRESS: 'Express consent (opted in)',
  IMPLIED_INQUIRY: 'Implied — inquiry (6 months)',
  IMPLIED_PURCHASE: 'Implied — purchase (2 years)',
};

export const COMPLIANCE_NOTE =
  'Email consent tools follow CASL (Canada’s anti-spam legislation) as described by the Government of Canada (fightspam.gc.ca) and the CRTC. They are not legal advice — confirm your practices with counsel.';

/** Template variables, by group. Anything else in `{{ }}` is rejected. */
export const TEMPLATE_VARIABLES = [
  'customer.first_name',
  'customer.last_name',
  'customer.email',
  'dealer.name',
  'dealer.phone',
  'dealer.email',
  'dealer.address',
  'vehicle.year',
  'vehicle.make',
  'vehicle.model',
  'vehicle.trim',
  'vehicle.price',
  'vehicle.vin',
  'vehicle.url',
  'salesperson.name',
  'salesperson.phone',
  'salesperson.email',
  'appointment.date',
  'appointment.time',
  'lead.next_follow_up',
  'ticket.number',
  'ticket.subject',
  'ticket.status',
  'ticket.url',
  'user.first_name',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export const DEALER_TEMPLATE_VARIABLES = TEMPLATE_VARIABLES.filter(
  (variable) => !variable.startsWith('ticket.') && !variable.startsWith('user.'),
);
export const SUPPORT_TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  'user.first_name',
  'ticket.number',
  'ticket.subject',
  'ticket.status',
  'ticket.url',
];

/** `{{ customer.first_name }}` → the names a template uses. */
export function templateVariablesIn(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((match) => match[1]!);
}

export const TEMPLATE_CATEGORIES = [
  'INTRODUCTION',
  'INQUIRY',
  'APPOINTMENT',
  'FOLLOW_UP',
  'NURTURE',
  'POST_SALE',
  'SERVICE',
  'MARKETING',
  'SUPPORT',
  'OTHER',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const CAMPAIGN_TYPES = [
  'LEAD_NURTURE',
  'RE_ENGAGEMENT',
  'NEW_INVENTORY',
  'VEHICLE_PROMOTION',
  'CUSTOMER_FOLLOW_UP',
  'SOLD_CUSTOMER',
  'SERVICE_REMINDER',
  'SEASONAL',
  'CUSTOM',
] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];
export const CAMPAIGN_STATUSES = ['DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

// --- Automation ---------------------------------------------------------------------

export const AUTOMATION_SCOPES = ['DEALER', 'SUPPORT'] as const;
export type AutomationScope = (typeof AUTOMATION_SCOPES)[number];

export const DEALER_TRIGGERS = [
  'LEAD_CREATED',
  'LEAD_ASSIGNED',
  'LEAD_STATUS_CHANGED',
  'VEHICLE_INQUIRY',
  'CUSTOMER_CREATED',
  'APPOINTMENT_CREATED',
  'APPOINTMENT_CONFIRMED',
  'APPOINTMENT_CANCELLED',
  'APPOINTMENT_COMPLETED',
  'TEST_DRIVE_COMPLETED',
  'QUOTE_CREATED',
  'TRADE_IN_SUBMITTED',
  'FINANCING_REQUESTED',
  'NO_RESPONSE',
  'DEAL_WON',
  'DEAL_LOST',
  'VEHICLE_SOLD',
  'CUSTOMER_INACTIVE',
  'TASK_OVERDUE',
  'MANUAL',
] as const;
export const SUPPORT_TRIGGERS = [
  'TICKET_CREATED',
  'TICKET_STATUS_CHANGED',
  'TICKET_WAITING',
  'TICKET_RESOLVED',
  'MANUAL',
] as const;
export const AUTOMATION_TRIGGERS = [...new Set([...DEALER_TRIGGERS, ...SUPPORT_TRIGGERS])] as const;
export type AutomationTrigger =
  (typeof DEALER_TRIGGERS)[number] | (typeof SUPPORT_TRIGGERS)[number];

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  LEAD_CREATED: 'A lead is created',
  LEAD_ASSIGNED: 'A lead is assigned',
  LEAD_STATUS_CHANGED: 'A lead’s status changes',
  VEHICLE_INQUIRY: 'A vehicle inquiry arrives',
  CUSTOMER_CREATED: 'A customer is created',
  APPOINTMENT_CREATED: 'An appointment is booked',
  APPOINTMENT_CONFIRMED: 'An appointment is confirmed',
  APPOINTMENT_CANCELLED: 'An appointment is cancelled',
  APPOINTMENT_COMPLETED: 'An appointment is completed',
  TEST_DRIVE_COMPLETED: 'A test drive is completed',
  QUOTE_CREATED: 'A quote is logged',
  TRADE_IN_SUBMITTED: 'A trade-in is submitted',
  FINANCING_REQUESTED: 'Financing is requested',
  NO_RESPONSE: 'No response for a number of days',
  DEAL_WON: 'A deal is won',
  DEAL_LOST: 'A deal is lost',
  VEHICLE_SOLD: 'A vehicle is sold to the customer',
  CUSTOMER_INACTIVE: 'A customer has been inactive',
  TASK_OVERDUE: 'A task becomes overdue',
  MANUAL: 'Started by hand',
  TICKET_CREATED: 'A ticket is created',
  TICKET_STATUS_CHANGED: 'A ticket’s status changes',
  TICKET_WAITING: 'A ticket waits on the user for a number of days',
  TICKET_RESOLVED: 'A ticket is resolved',
};

export const CONDITION_FIELDS = [
  'lead.status',
  'lead.status_kind',
  'lead.source',
  'lead.score',
  'lead.temperature',
  'lead.province',
  'lead.assigned',
  'lead.tags',
  'lead.has_replied',
  'lead.has_opened',
  'lead.has_clicked',
  'lead.days_since_contact',
  'lead.days_since_created',
  'lead.is_customer',
  'vehicle.make',
  'vehicle.price',
  'appointment.status',
  'ticket.status',
  'ticket.priority',
  'ticket.category',
  'ticket.user_replied',
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'contains',
  'is_true',
  'is_false',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const AUTOMATION_STEP_TYPES = [
  'WAIT',
  'CONDITION',
  'SEND_EMAIL',
  'CREATE_TASK',
  'ASSIGN',
  'SET_STATUS',
  'ADD_TAG',
  'REMOVE_TAG',
  'APPOINTMENT_REMINDER',
  'NOTIFY',
  'MOVE_TO_NURTURE',
  'START_AUTOMATION',
  'STOP',
] as const;
export type AutomationStepType = (typeof AUTOMATION_STEP_TYPES)[number];

export const AUTOMATION_STEP_LABELS: Record<AutomationStepType, string> = {
  WAIT: 'Wait',
  CONDITION: 'If / otherwise',
  SEND_EMAIL: 'Send email',
  CREATE_TASK: 'Create task',
  ASSIGN: 'Assign',
  SET_STATUS: 'Change status',
  ADD_TAG: 'Add tag',
  REMOVE_TAG: 'Remove tag',
  APPOINTMENT_REMINDER: 'Appointment reminder',
  NOTIFY: 'Send notification',
  MOVE_TO_NURTURE: 'Move to nurture',
  START_AUTOMATION: 'Start another automation',
  STOP: 'Stop',
};

export const STOP_CONDITIONS = [
  'REPLIED',
  'WON',
  'LOST',
  'APPOINTMENT_COMPLETED',
  'UNSUBSCRIBED',
  'EMAIL_INVALID',
  'TICKET_CLOSED',
  'USER_REPLIED',
] as const;
export type StopCondition = (typeof STOP_CONDITIONS)[number];

export const ENROLLMENT_STATUSES = ['ACTIVE', 'WAITING', 'COMPLETED', 'STOPPED', 'FAILED'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

// --- Admin support CRM ---------------------------------------------------------------

export const TICKET_STATUSES = [
  'NEW',
  'OPEN',
  'IN_PROGRESS',
  'WAITING_FOR_USER',
  'WAITING_FOR_DEALER',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_OPEN_STATUSES: readonly TicketStatus[] = TICKET_STATUSES.filter(
  (status) => status !== 'RESOLVED' && status !== 'CLOSED',
);

export const DEFAULT_TICKET_CATEGORIES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'DEALER_ISSUE', label: 'Dealer issue' },
  { key: 'USER_ISSUE', label: 'User issue' },
  { key: 'TECHNICAL', label: 'Technical issue' },
  { key: 'ACCOUNT', label: 'Account issue' },
  { key: 'VERIFICATION', label: 'Verification issue' },
  { key: 'BILLING', label: 'Billing' },
  { key: 'FEATURE_REQUEST', label: 'Feature request' },
  { key: 'COMPLAINT', label: 'Complaint' },
  { key: 'OTHER', label: 'Other' },
];

export const TICKET_SOURCES = [
  'ADMIN',
  'USER_PORTAL',
  'CONTACT_FORM',
  'SUPPORT_CHAT',
  'EMAIL',
] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

/** PUBLIC messages reach the requester; INTERNAL notes never leave the admin team. */
export const TICKET_VISIBILITIES = ['PUBLIC', 'INTERNAL'] as const;
export type TicketVisibility = (typeof TICKET_VISIBILITIES)[number];

export const ADMIN_TASK_TYPES = [
  'FOLLOW_UP_DEALER',
  'CALL_USER',
  'INVESTIGATE',
  'VERIFY_ACCOUNT',
  'BILLING_FOLLOW_UP',
  'REVIEW_FEATURE_REQUEST',
  'ESCALATE',
  'OTHER',
] as const;
export type AdminTaskType = (typeof ADMIN_TASK_TYPES)[number];

// --- Notifications -------------------------------------------------------------------

export const CRM_NOTIFICATION_EVENTS = [
  'LEAD_ASSIGNED',
  'TASK_ASSIGNED',
  'TASK_OVERDUE',
  'APPOINTMENT_UPCOMING',
  'LEAD_REPLIED',
  'TICKET_ASSIGNED',
  'TICKET_UPDATED',
  'TICKET_ESCALATED',
] as const;
export type CrmNotificationEvent = (typeof CRM_NOTIFICATION_EVENTS)[number];

export const CRM_NOTIFICATION_LABELS: Record<CrmNotificationEvent, string> = {
  LEAD_ASSIGNED: 'A lead is assigned to me',
  TASK_ASSIGNED: 'A task is assigned to me',
  TASK_OVERDUE: 'One of my tasks is overdue',
  APPOINTMENT_UPCOMING: 'An appointment is coming up',
  LEAD_REPLIED: 'A lead replies',
  TICKET_ASSIGNED: 'A ticket is assigned to me',
  TICKET_UPDATED: 'A ticket I handle is updated',
  TICKET_ESCALATED: 'A ticket is escalated',
};

// --- Ranges -----------------------------------------------------------------------------

export const CRM_RANGE_PRESETS = [
  'TODAY',
  'THIS_WEEK',
  'THIS_MONTH',
  'LAST_MONTH',
  'THIS_QUARTER',
  'THIS_YEAR',
  'CUSTOM',
] as const;
export type CrmRangePreset = (typeof CRM_RANGE_PRESETS)[number];
export const CRM_RANGE_LABELS: Record<CrmRangePreset, string> = {
  TODAY: 'Today',
  THIS_WEEK: 'This week',
  THIS_MONTH: 'This month',
  LAST_MONTH: 'Last month',
  THIS_QUARTER: 'Quarter',
  THIS_YEAR: 'Year',
  CUSTOM: 'Custom range',
};

// --- Helpers -----------------------------------------------------------------------------

/** "(604) 555-0142", "+1 604 555 0142" → "6045550142", for duplicate matching. */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  return value ? value : null;
}
