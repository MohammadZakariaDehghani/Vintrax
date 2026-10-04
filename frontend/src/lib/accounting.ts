import {
  DATE_RANGE_PRESETS,
  centsToDecimalString,
  formatLedgerCents,
  type AccountingPermission,
  type DateRangePreset,
  type DealerStaffRole,
} from '@vintrax/shared';
import { api, apiRequest } from '@/lib/api-client';
import { saveBlob } from '@/lib/save-file';

/**
 * The dealer accounting API, under /dealer/accounting.
 *
 * Someone on more than one dealership's staff picks the books they work in;
 * the choice travels as the `x-dealer-id` header and the server checks it
 * against their memberships on every request.
 */

const DEALER_KEY = 'vintrax.accounting.dealerId';
const BASE = '/dealer/accounting';

export function selectedDealerId(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(DEALER_KEY);
  } catch {
    return null;
  }
}

export function selectDealer(dealerId: string | null) {
  try {
    if (dealerId) window.localStorage.setItem(DEALER_KEY, dealerId);
    else window.localStorage.removeItem(DEALER_KEY);
  } catch {
    // Storage unavailable: the server falls back to the first dealership.
  }
}

function headers(): Record<string, string> {
  const dealerId = selectedDealerId();
  return dealerId ? { 'x-dealer-id': dealerId } : {};
}

export const acct = {
  get: <T>(path: string, signal?: AbortSignal) =>
    apiRequest<T>(`${BASE}${path}`, { method: 'GET', headers: headers(), signal }),
  post: <T>(path: string, body?: unknown) =>
    apiRequest<T>(`${BASE}${path}`, { method: 'POST', body: body ?? {}, headers: headers() }),
  patch: <T>(path: string, body: unknown) =>
    apiRequest<T>(`${BASE}${path}`, { method: 'PATCH', body, headers: headers() }),
  delete: <T>(path: string) =>
    apiRequest<T>(`${BASE}${path}`, { method: 'DELETE', headers: headers() }),
  upload: <T>(path: string, file: File) => api.upload<T>(`${BASE}${path}`, file, {}, headers()),
  /** Downloads a file the API builds (an export, an attachment) and saves it. */
  save: async (path: string, fileName: string) => {
    const blob = await api.download(`${BASE}${path}`, undefined, headers());
    saveBlob(blob, fileName);
  },
};

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

/** "$1,234.56", negatives in parentheses — the ledger's own format. */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return formatLedgerCents(cents);
}

/** Cents back to what a person would type: 123450 → "1234.50". */
export function centsInput(cents: number): string {
  return centsToDecimalString(cents);
}

/** Basis points to "12.34%". */
export function percent(basisPoints: number | null | undefined): string {
  if (basisPoints === null || basisPoints === undefined) return '—';
  return `${(basisPoints / 100).toFixed(2)}%`;
}

/** "2026-04-01" to "Apr 1, 2026", without a time zone shifting the day. */
export function isoDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return value;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Today in Toronto as YYYY-MM-DD, the books' day. */
export function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

// --- Shared shapes -------------------------------------------------------------------

export interface AccountingStatus {
  setUp: boolean;
  dealer: { id: string; name: string; province: string | null; businessNumber: string | null };
  role: DealerStaffRole;
  permissions: AccountingPermission[];
  settings: AccountingSettingsView | null;
}

export interface AccountingSettingsView {
  legalName: string;
  businessNumber: string | null;
  gstHstNumber: string | null;
  pstNumber: string | null;
  qstNumber: string | null;
  province: string;
  fiscalYearStartMonth: number;
  fiscalYearStartDay: number;
  currency: string;
  taxFilingFrequency: string;
  defaultBankAccountId: string | null;
  invoicePrefix: string;
  journalPrefix: string;
  allowNegativeInventory: boolean;
  setUpOn: string;
}

export interface Dealership {
  dealerId: string;
  name: string;
  role: DealerStaffRole;
}

export interface Range {
  from: string;
  to: string;
}

export interface RangeState {
  preset: DateRangePreset;
  from: string;
  to: string;
}

export const DEFAULT_RANGE: RangeState = { preset: 'THIS_MONTH', from: '', to: '' };

/** The query parameters a range filter sends. */
export function rangeParams(range: RangeState): Record<string, string> {
  return range.preset === 'CUSTOM'
    ? { preset: 'CUSTOM', from: range.from, to: range.to }
    : { preset: range.preset };
}

export function isPreset(value: string): value is DateRangePreset {
  return (DATE_RANGE_PRESETS as readonly string[]).includes(value);
}

export interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype: string;
  isActive: boolean;
  isSystem: boolean;
  isBankAccount: boolean;
  balanceCents: number;
  systemKey: string | null;
  description: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Where a ledger entry's source document lives in the app. */
export function sourceHref(sourceType: string | null, sourceId: string | null): string | null {
  if (!sourceType || !sourceId) return null;
  switch (sourceType) {
    case 'VehicleSale':
      return `/dealer/accounting/sales/${sourceId}`;
    case 'VehicleAcquisition':
      return `/dealer/accounting/purchases?id=${sourceId}`;
    case 'CustomerInvoice':
      return `/dealer/accounting/receivables?invoice=${sourceId}`;
    case 'VendorBill':
      return `/dealer/accounting/payables?bill=${sourceId}`;
    case 'Payment':
      return `/dealer/accounting/payments?payment=${sourceId}`;
    case 'Expense':
      return `/dealer/accounting/expenses?expense=${sourceId}`;
    case 'CustomerDeposit':
      return `/dealer/accounting/deposits?deposit=${sourceId}`;
    case 'BankTransaction':
    case 'BankReconciliation':
    case 'BankAccount':
      return '/dealer/accounting/banking';
    case 'FloorPlanNote':
      return '/dealer/accounting/floor-plan';
    case 'FiscalYear':
      return '/dealer/accounting/periods';
    default:
      return null;
  }
}

/** A YYYY-MM-DD date moved by whole days, in UTC so no time zone shifts it. */
export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
