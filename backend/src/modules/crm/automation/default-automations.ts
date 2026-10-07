import type { AutomationInput, StopCondition } from '@vintrax/shared';

export interface DefaultAutomation {
  key: string;
  name: string;
  description: string;
  trigger: string;
  triggerConfig?: AutomationInput['triggerConfig'];
  steps: AutomationInput['steps'];
  stopConditions: StopCondition[];
  respectSendWindow: boolean;
  /** Support automations run from day one; a dealer switches its own on. */
  isActive: boolean;
}

const DAY = 24 * 60;
const SALES_STOPS: StopCondition[] = [
  'REPLIED',
  'WON',
  'LOST',
  'APPOINTMENT_COMPLETED',
  'UNSUBSCRIBED',
  'EMAIL_INVALID',
];

/**
 * Starting sequences for a dealership. They are created switched off: a
 * dealer reads them, edits the wording, and turns them on — nobody's
 * customers start receiving emails because the CRM was opened.
 */
export const DEFAULT_DEALER_AUTOMATIONS: DefaultAutomation[] = [
  {
    key: 'NEW_LEAD_FOLLOW_UP',
    name: 'New lead follow-up',
    description:
      'Introduces the salesperson at once, then follows up over two weeks until the customer replies, and moves a silent lead to Nurture.',
    trigger: 'LEAD_CREATED',
    steps: [
      { id: 'intro', type: 'SEND_EMAIL', next: 'wait1', config: { templateKey: 'NEW_LEAD_INTRO' } },
      { id: 'wait1', type: 'WAIT', next: 'replied1', config: { minutes: DAY } },
      {
        id: 'replied1',
        type: 'CONDITION',
        yes: 'stop',
        no: 'day1',
        config: { conditions: [{ field: 'lead.has_replied', op: 'is_true' }] },
      },
      { id: 'day1', type: 'SEND_EMAIL', next: 'wait2', config: { templateKey: 'FOLLOW_UP_DAY_1' } },
      { id: 'wait2', type: 'WAIT', next: 'call', config: { minutes: 2 * DAY } },
      {
        id: 'call',
        type: 'CREATE_TASK',
        next: 'wait3',
        config: { title: 'Call the customer', dueInMinutes: 4 * 60, priority: 'HIGH' },
      },
      { id: 'wait3', type: 'WAIT', next: 'day3', config: { minutes: DAY } },
      { id: 'day3', type: 'SEND_EMAIL', next: 'wait7', config: { templateKey: 'FOLLOW_UP_DAY_3' } },
      { id: 'wait7', type: 'WAIT', next: 'day7', config: { minutes: 4 * DAY } },
      {
        id: 'day7',
        type: 'SEND_EMAIL',
        next: 'wait14',
        config: { templateKey: 'FOLLOW_UP_DAY_7' },
      },
      { id: 'wait14', type: 'WAIT', next: 'day14', config: { minutes: 7 * DAY } },
      {
        id: 'day14',
        type: 'SEND_EMAIL',
        next: 'waitNurture',
        config: { templateKey: 'FOLLOW_UP_DAY_14' },
      },
      { id: 'waitNurture', type: 'WAIT', next: 'nurture', config: { minutes: 16 * DAY } },
      { id: 'nurture', type: 'MOVE_TO_NURTURE', config: {} },
      { id: 'stop', type: 'STOP', config: {} },
    ],
    stopConditions: SALES_STOPS,
    respectSendWindow: true,
    isActive: false,
  },
  {
    key: 'APPOINTMENT_CONFIRMATION',
    name: 'Appointment confirmation and reminder',
    description: 'Confirms a booked appointment and reminds the customer before it.',
    trigger: 'APPOINTMENT_CREATED',
    steps: [
      {
        id: 'confirm',
        type: 'SEND_EMAIL',
        next: 'remind',
        config: { templateKey: 'APPOINTMENT_CONFIRMATION' },
      },
      {
        id: 'remind',
        type: 'APPOINTMENT_REMINDER',
        config: { templateKey: 'APPOINTMENT_REMINDER' },
      },
    ],
    stopConditions: ['LOST', 'UNSUBSCRIBED', 'EMAIL_INVALID'],
    respectSendWindow: false,
    isActive: false,
  },
  {
    key: 'NO_RESPONSE',
    name: 'No response',
    description: 'When a lead has not answered for a few days: one more email and a call task.',
    trigger: 'NO_RESPONSE',
    triggerConfig: { days: 3 },
    steps: [
      {
        id: 'email',
        type: 'SEND_EMAIL',
        next: 'task',
        config: { templateKey: 'NO_RESPONSE_FOLLOW_UP' },
      },
      {
        id: 'task',
        type: 'CREATE_TASK',
        config: { title: 'No reply yet — try calling', dueInMinutes: DAY, priority: 'MEDIUM' },
      },
    ],
    stopConditions: SALES_STOPS,
    respectSendWindow: true,
    isActive: false,
  },
  {
    key: 'TEST_DRIVE_FOLLOW_UP',
    name: 'Test drive follow-up',
    description: 'The day after a test drive, asks how it went.',
    trigger: 'TEST_DRIVE_COMPLETED',
    steps: [
      { id: 'wait', type: 'WAIT', next: 'email', config: { minutes: DAY } },
      { id: 'email', type: 'SEND_EMAIL', config: { templateKey: 'TEST_DRIVE_FOLLOW_UP' } },
    ],
    stopConditions: SALES_STOPS.filter((stop) => stop !== 'APPOINTMENT_COMPLETED'),
    respectSendWindow: true,
    isActive: false,
  },
  {
    key: 'FINANCING_FOLLOW_UP',
    name: 'Financing follow-up',
    description: 'When financing is requested: a call task now and an email the next day.',
    trigger: 'FINANCING_REQUESTED',
    steps: [
      {
        id: 'task',
        type: 'CREATE_TASK',
        next: 'wait',
        config: { title: 'Review the finance application', dueInMinutes: 2 * 60, priority: 'HIGH' },
      },
      { id: 'wait', type: 'WAIT', next: 'email', config: { minutes: DAY } },
      { id: 'email', type: 'SEND_EMAIL', config: { templateKey: 'FINANCING_FOLLOW_UP' } },
    ],
    stopConditions: SALES_STOPS,
    respectSendWindow: true,
    isActive: false,
  },
  {
    key: 'TRADE_IN_FOLLOW_UP',
    name: 'Trade-in follow-up',
    description: 'Invites the customer to bring their trade-in for an appraisal.',
    trigger: 'TRADE_IN_SUBMITTED',
    steps: [
      { id: 'wait', type: 'WAIT', next: 'email', config: { minutes: 60 } },
      { id: 'email', type: 'SEND_EMAIL', config: { templateKey: 'TRADE_IN_FOLLOW_UP' } },
    ],
    stopConditions: SALES_STOPS,
    respectSendWindow: true,
    isActive: false,
  },
  {
    key: 'POST_SALE',
    name: 'Post-sale',
    description:
      'Thanks the buyer, checks in after delivery, asks for a review and reminds them about service. Review and service emails are marketing and go only with consent.',
    trigger: 'VEHICLE_SOLD',
    steps: [
      {
        id: 'thanks',
        type: 'SEND_EMAIL',
        next: 'wait1',
        config: { templateKey: 'SOLD_THANK_YOU' },
      },
      { id: 'wait1', type: 'WAIT', next: 'delivery', config: { minutes: 3 * DAY } },
      {
        id: 'delivery',
        type: 'SEND_EMAIL',
        next: 'wait2',
        config: { templateKey: 'DELIVERY_FOLLOW_UP' },
      },
      { id: 'wait2', type: 'WAIT', next: 'review', config: { minutes: 7 * DAY } },
      {
        id: 'review',
        type: 'SEND_EMAIL',
        next: 'wait3',
        config: { templateKey: 'REVIEW_REQUEST' },
      },
      { id: 'wait3', type: 'WAIT', next: 'service', config: { minutes: 180 * DAY } },
      { id: 'service', type: 'SEND_EMAIL', config: { templateKey: 'SERVICE_REMINDER' } },
    ],
    stopConditions: ['UNSUBSCRIBED', 'EMAIL_INVALID'],
    respectSendWindow: true,
    isActive: false,
  },
  {
    key: 'RE_ENGAGEMENT',
    name: 'Re-engagement',
    description: 'Reaches out to a lead that has gone quiet for a month.',
    trigger: 'CUSTOMER_INACTIVE',
    triggerConfig: { days: 30 },
    steps: [{ id: 'email', type: 'SEND_EMAIL', config: { templateKey: 'RE_ENGAGEMENT' } }],
    stopConditions: ['REPLIED', 'WON', 'LOST', 'UNSUBSCRIBED', 'EMAIL_INVALID'],
    respectSendWindow: true,
    isActive: false,
  },
];

/** The support desk's own workflows (D-066). */
export const DEFAULT_SUPPORT_AUTOMATIONS: DefaultAutomation[] = [
  {
    key: 'TICKET_CREATED',
    name: 'New ticket',
    description: 'Assigns the ticket, tells the team, and confirms receipt to the requester.',
    trigger: 'TICKET_CREATED',
    steps: [
      { id: 'assign', type: 'ASSIGN', next: 'notify', config: {} },
      {
        id: 'notify',
        type: 'NOTIFY',
        next: 'confirm',
        config: { title: 'New support ticket', recipients: 'ASSIGNEE' },
      },
      { id: 'confirm', type: 'SEND_EMAIL', config: { templateKey: 'TICKET_RECEIVED' } },
    ],
    stopConditions: ['TICKET_CLOSED'],
    respectSendWindow: false,
    isActive: true,
  },
  {
    key: 'TICKET_WAITING',
    name: 'Waiting on the requester',
    description: 'Reminds the requester after the ticket has waited on them for three days.',
    trigger: 'TICKET_WAITING',
    triggerConfig: { days: 3 },
    steps: [
      { id: 'remind', type: 'SEND_EMAIL', config: { templateKey: 'TICKET_WAITING_REMINDER' } },
    ],
    stopConditions: ['TICKET_CLOSED', 'USER_REPLIED'],
    respectSendWindow: false,
    isActive: true,
  },
  {
    key: 'TICKET_RESOLVED',
    name: 'Resolution and survey',
    description: 'Tells the requester the ticket is resolved, then asks how we did.',
    trigger: 'TICKET_RESOLVED',
    steps: [
      {
        id: 'resolved',
        type: 'SEND_EMAIL',
        next: 'wait',
        config: { templateKey: 'TICKET_RESOLVED' },
      },
      { id: 'wait', type: 'WAIT', next: 'survey', config: { minutes: DAY } },
      { id: 'survey', type: 'SEND_EMAIL', config: { templateKey: 'TICKET_SURVEY' } },
    ],
    stopConditions: ['USER_REPLIED'],
    respectSendWindow: false,
    isActive: true,
  },
];
