import type { CrmPermission, DealerStaffRole } from '@vintrax/shared';
import { api, apiRequest } from '@/lib/api-client';
import { saveBlob } from '@/lib/save-file';

/**
 * The Dealer CRM API (/crm) and the Admin support CRM API (/admin/crm).
 *
 * Someone on more than one dealership's staff picks the CRM they work in;
 * the choice travels as the `x-dealer-id` header, checked by the server
 * against their memberships on every request.
 */

const DEALER_KEY = 'vintrax.crm.dealerId';

export function selectedCrmDealer(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(DEALER_KEY);
  } catch {
    return null;
  }
}

export function selectCrmDealer(dealerId: string | null) {
  try {
    if (dealerId) window.localStorage.setItem(DEALER_KEY, dealerId);
    else window.localStorage.removeItem(DEALER_KEY);
  } catch {
    // Storage unavailable: the server falls back to the first dealership.
  }
}

function headers(): Record<string, string> {
  const dealerId = selectedCrmDealer();
  return dealerId ? { 'x-dealer-id': dealerId } : {};
}

function client(base: string, withDealer: boolean) {
  const h = () => (withDealer ? headers() : {});
  return {
    get: <T>(path: string, signal?: AbortSignal) =>
      apiRequest<T>(`${base}${path}`, { method: 'GET', headers: h(), signal }),
    post: <T>(path: string, body?: unknown) =>
      apiRequest<T>(`${base}${path}`, { method: 'POST', body: body ?? {}, headers: h() }),
    put: <T>(path: string, body: unknown) =>
      apiRequest<T>(`${base}${path}`, { method: 'PUT', body, headers: h() }),
    delete: <T>(path: string) => apiRequest<T>(`${base}${path}`, { method: 'DELETE', headers: h() }),
    save: async (path: string, fileName: string) => {
      const blob = await api.download(`${base}${path}`, undefined, h());
      saveBlob(blob, fileName);
    },
  };
}

/** Dealer CRM. */
export const crm = client('/crm', true);
/** Admin support CRM (administrators). */
export const support = client('/admin/crm', false);
/** A user's own support tickets. */
export const portal = client('/support', false);

export type CrmClient = ReturnType<typeof client>;

/** Builds a query string, leaving out empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

// --- Formatting ------------------------------------------------------------------------

export function personName(person: { firstName: string; lastName?: string | null } | null | undefined): string {
  if (!person) return 'Unassigned';
  return [person.firstName, person.lastName].filter(Boolean).join(' ');
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function shortDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function time(value: string | Date): string {
  return new Date(value).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
}

/** A Date as the value of a datetime-local input, in the browser's zone. */
export function toLocalInput(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** A datetime-local input's value as an ISO instant (or null when empty). */
export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function dollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return (cents / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
}

export function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value}%`;
}

export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

// --- Shapes -----------------------------------------------------------------------------

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
}

export interface LeadStatus {
  id: string;
  key: string;
  label: string;
  kind: 'OPEN' | 'WON' | 'LOST' | 'NURTURE' | 'UNRESPONSIVE';
  position?: number;
  inPipeline?: boolean;
  isActive?: boolean;
  _count?: { leads: number };
}

export interface LeadSource {
  id: string;
  key: string;
  label: string;
  monthlyCostCents?: number | null;
  isActive?: boolean;
  _count?: { leads: number };
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  _count?: { leads: number };
}

export interface StaffMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: DealerStaffRole;
  roleLabel: string;
  team: string | null;
}

export interface CrmSettings {
  dealerId: string;
  timezone: string;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  sendDays: number[];
  responseTargetMinutes: number;
  hotThreshold: number;
  warmThreshold: number;
  noResponseDays: number;
  inactiveDays: number;
  assignmentMode: 'MANUAL' | 'ROUND_ROBIN' | 'RULES';
  createFollowUpTask: boolean;
  senderName: string | null;
  replyToEmail: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  impliedConsentFromInquiry: boolean;
  impliedConsentFromPurchase: boolean;
  postSaleEnabled: boolean;
}

export interface CrmMe {
  dealer: { id: string; name: string; phone: string | null; city: string | null; province: string | null };
  settings: CrmSettings;
  statuses: LeadStatus[];
  sources: LeadSource[];
  tags: Tag[];
  staff: StaffMember[];
  me: { userId: string; role: DealerStaffRole; permissions: CrmPermission[] };
}

export interface CrmDealership {
  dealerId: string;
  name: string;
  role: DealerStaffRole;
}

export interface LeadRow {
  id: string;
  number: number;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  preferredContact: 'PHONE' | 'EMAIL' | 'TEXT' | null;
  city: string | null;
  province: string | null;
  score: number;
  temperature: 'HOT' | 'WARM' | 'COLD';
  campaign: string | null;
  budgetCents: number | null;
  financingInterest: boolean;
  tradeInInterest: boolean;
  interestedVin: string | null;
  firstContactAt: string | null;
  lastContactAt: string | null;
  lastActivityAt: string | null;
  nextFollowUpAt: string | null;
  lastRepliedAt: string | null;
  wonAt: string | null;
  lostAt: string | null;
  customerId: string | null;
  createdAt: string;
  updatedAt: string;
  status: LeadStatus;
  source: LeadSource | null;
  assignedTo: Person | null;
  vehicle: { id: string; title: string; year: number; make: string; model: string; trim: string | null; priceCad: number; vin: string | null } | null;
  tags: Tag[];
}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  leadId: string | null;
  assignedToId: string | null;
  vehicleId: string | null;
  dueAt: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  reminderAt: string | null;
  recurrence: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  completedAt: string | null;
  overdue?: boolean;
  assignedTo: Person | null;
  lead?: { id: string; number: number; firstName: string; lastName: string | null; phone?: string | null; email?: string | null } | null;
}

export interface AppointmentRow {
  id: string;
  leadId: string;
  vehicleId: string | null;
  salespersonId: string | null;
  type: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  notes: string | null;
  status: string;
  reminderMinutes: number | null;
  salesperson: Person | null;
  vehicle: { id: string; title: string } | null;
  lead?: { id: string; number: number; firstName: string; lastName: string | null; phone?: string | null };
}

export interface TimelineItem {
  id: string;
  type: string;
  isSystem: boolean;
  occurredAt: string;
  title: string;
  status: string | null;
  notes: string | null;
  outcome: string | null;
  nextAction: string | null;
  emailId: string | null;
  metadata: Record<string, unknown> | null;
  user: Person | null;
  lead?: { id: string; number: number; firstName: string; lastName: string | null };
}

export interface EmailRow {
  id: string;
  toEmail: string;
  toName: string | null;
  subject: string;
  purpose: 'TRANSACTIONAL' | 'MARKETING';
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  repliedAt: string | null;
  bouncedAt: string | null;
  attempts: number;
  lastError: string | null;
  provider: string | null;
  enrollmentId: string | null;
  campaignId: string | null;
  createdAt: string;
  lead: { id: string; number: number; firstName: string; lastName: string | null } | null;
  campaign: { id: string; name: string } | null;
}

export interface TemplateRow {
  id: string;
  key: string | null;
  name: string;
  category: string;
  purpose: 'TRANSACTIONAL' | 'MARKETING';
  subject: string;
  isActive: boolean;
  version: number;
  updatedAt: string;
  _count: { emails: number };
}

export interface Template extends Omit<TemplateRow, '_count'> {
  bodyHtml: string;
  bodyText: string;
  history: Array<{ version: number; subject: string; bodyHtml: string; bodyText: string; savedAt: string }> | null;
}

export interface AutomationStepView {
  id: string;
  type: string;
  next?: string | null;
  yes?: string | null;
  no?: string | null;
  config: Record<string, unknown>;
}

export interface AutomationRow {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  trigger: string;
  triggerConfig: { days?: number; statusKey?: string; conditions?: Array<{ field: string; op: string; value?: unknown }> } | null;
  steps: AutomationStepView[];
  stopConditions: string[];
  respectSendWindow: boolean;
  isActive: boolean;
  version: number;
  stats?: {
    active: number;
    completed: number;
    stopped: number;
    failed: number;
    emailsSent: number;
    opened: number;
    clicked: number;
    replied: number;
  };
}

export interface TicketRow {
  id: string;
  number: number;
  subject: string;
  status: string;
  priority: string;
  source: string;
  requesterEmail: string;
  requesterName: string | null;
  dueAt: string | null;
  firstResponseAt: string | null;
  lastPublicReplyBy: string | null;
  updatedAt: string;
  createdAt: string;
  overdue?: boolean;
  requester: Person | null;
  assignedTo: Person | null;
  dealer: { id: string; name: string } | null;
  category: { id: string; label: string } | null;
  team: { id: string; name: string } | null;
  tags: Array<{ id: string; name: string }>;
}

export interface SupportSettingsView {
  categories: Array<{ id: string; key: string; label: string; isActive: boolean }>;
  teams: Array<{ id: string; name: string; memberIds: string[]; isActive: boolean }>;
  admins: Array<{ id: string; firstName: string; lastName: string; email: string }>;
  settings: { firstResponseHours: Record<string, number>; resolutionHours: Record<string, number>; waitingReminderDays: number; autoCloseDays: number; defaultTeamId: string | null };
}
