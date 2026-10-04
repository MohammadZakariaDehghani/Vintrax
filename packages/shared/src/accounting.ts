/**
 * Dealer accounting: the vocabulary shared by the API and the dealer portal.
 *
 * Money crosses the API as integer cents (`…Cents` fields), never as a
 * floating-point number of dollars. Inputs may be typed as decimal strings
 * ("22500.50"); `parseMoneyToCents` turns them into exact cents with string
 * arithmetic, so 0.1 + 0.2 never happens to a dollar amount.
 *
 * Nothing here is tax or legal advice: rates are configuration a dealer and
 * their accountant are responsible for, and the defaults cite their sources.
 */

// --- Accounts ----------------------------------------------------------------

export const ACCOUNT_TYPES = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'COGS',
  'EXPENSE',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  COGS: 'Cost of sales',
  EXPENSE: 'Expenses',
};

/** Debit-normal accounts grow with debits; the rest grow with credits. */
export function isDebitNormal(type: AccountType): boolean {
  return type === 'ASSET' || type === 'COGS' || type === 'EXPENSE';
}

export const ACCOUNT_SUBTYPES = [
  'CASH',
  'BANK',
  'RECEIVABLE',
  'INVENTORY',
  'OTHER_CURRENT_ASSET',
  'TAX_RECOVERABLE',
  'FIXED_ASSET',
  'ACCUMULATED_DEPRECIATION',
  'PAYABLE',
  'TAX_PAYABLE',
  'CUSTOMER_DEPOSIT',
  'FLOOR_PLAN',
  'CREDIT_CARD',
  'CURRENT_LIABILITY',
  'LONG_TERM_LIABILITY',
  'EQUITY',
  'RETAINED_EARNINGS',
  'CURRENT_YEAR_EARNINGS',
  'OPERATING_REVENUE',
  'OTHER_INCOME',
  'COST_OF_SALES',
  'OPERATING_EXPENSE',
  'OTHER_EXPENSE',
] as const;
export type AccountSubtype = (typeof ACCOUNT_SUBTYPES)[number];

/** Which type each subtype belongs to — a custom account must agree. */
export const SUBTYPE_TYPE: Record<AccountSubtype, AccountType> = {
  CASH: 'ASSET',
  BANK: 'ASSET',
  RECEIVABLE: 'ASSET',
  INVENTORY: 'ASSET',
  OTHER_CURRENT_ASSET: 'ASSET',
  TAX_RECOVERABLE: 'ASSET',
  FIXED_ASSET: 'ASSET',
  ACCUMULATED_DEPRECIATION: 'ASSET',
  PAYABLE: 'LIABILITY',
  TAX_PAYABLE: 'LIABILITY',
  CUSTOMER_DEPOSIT: 'LIABILITY',
  FLOOR_PLAN: 'LIABILITY',
  CREDIT_CARD: 'LIABILITY',
  CURRENT_LIABILITY: 'LIABILITY',
  LONG_TERM_LIABILITY: 'LIABILITY',
  EQUITY: 'EQUITY',
  RETAINED_EARNINGS: 'EQUITY',
  CURRENT_YEAR_EARNINGS: 'EQUITY',
  OPERATING_REVENUE: 'REVENUE',
  OTHER_INCOME: 'REVENUE',
  COST_OF_SALES: 'COGS',
  OPERATING_EXPENSE: 'EXPENSE',
  OTHER_EXPENSE: 'EXPENSE',
};

export const ACCOUNT_SUBTYPE_LABELS: Record<AccountSubtype, string> = {
  CASH: 'Cash',
  BANK: 'Bank',
  RECEIVABLE: 'Receivable',
  INVENTORY: 'Inventory',
  OTHER_CURRENT_ASSET: 'Other current asset',
  TAX_RECOVERABLE: 'Recoverable tax',
  FIXED_ASSET: 'Fixed asset',
  ACCUMULATED_DEPRECIATION: 'Accumulated depreciation',
  PAYABLE: 'Payable',
  TAX_PAYABLE: 'Tax payable',
  CUSTOMER_DEPOSIT: 'Customer deposits',
  FLOOR_PLAN: 'Floor plan',
  CREDIT_CARD: 'Credit card',
  CURRENT_LIABILITY: 'Current liability',
  LONG_TERM_LIABILITY: 'Long-term liability',
  EQUITY: 'Equity',
  RETAINED_EARNINGS: 'Retained earnings',
  CURRENT_YEAR_EARNINGS: 'Current year earnings',
  OPERATING_REVENUE: 'Operating revenue',
  OTHER_INCOME: 'Other income',
  COST_OF_SALES: 'Cost of sales',
  OPERATING_EXPENSE: 'Operating expense',
  OTHER_EXPENSE: 'Other expense',
};

/** Balance-sheet grouping for the statement. */
export type BalanceSheetGroup =
  'CURRENT_ASSETS' | 'FIXED_ASSETS' | 'CURRENT_LIABILITIES' | 'LONG_TERM_LIABILITIES' | 'EQUITY';

export const SUBTYPE_BALANCE_SHEET_GROUP: Partial<Record<AccountSubtype, BalanceSheetGroup>> = {
  CASH: 'CURRENT_ASSETS',
  BANK: 'CURRENT_ASSETS',
  RECEIVABLE: 'CURRENT_ASSETS',
  INVENTORY: 'CURRENT_ASSETS',
  OTHER_CURRENT_ASSET: 'CURRENT_ASSETS',
  TAX_RECOVERABLE: 'CURRENT_ASSETS',
  FIXED_ASSET: 'FIXED_ASSETS',
  ACCUMULATED_DEPRECIATION: 'FIXED_ASSETS',
  PAYABLE: 'CURRENT_LIABILITIES',
  TAX_PAYABLE: 'CURRENT_LIABILITIES',
  CUSTOMER_DEPOSIT: 'CURRENT_LIABILITIES',
  FLOOR_PLAN: 'CURRENT_LIABILITIES',
  CREDIT_CARD: 'CURRENT_LIABILITIES',
  CURRENT_LIABILITY: 'CURRENT_LIABILITIES',
  LONG_TERM_LIABILITY: 'LONG_TERM_LIABILITIES',
  EQUITY: 'EQUITY',
  RETAINED_EARNINGS: 'EQUITY',
  CURRENT_YEAR_EARNINGS: 'EQUITY',
};

/**
 * Cash-flow classification for the indirect method. Cash accounts are the
 * subject of the statement; every other balance-sheet account's change lands
 * in one of the three sections.
 */
export type CashFlowSection = 'CASH' | 'OPERATING' | 'INVESTING' | 'FINANCING';

export const SUBTYPE_CASH_FLOW: Partial<Record<AccountSubtype, CashFlowSection>> = {
  CASH: 'CASH',
  BANK: 'CASH',
  RECEIVABLE: 'OPERATING',
  INVENTORY: 'OPERATING',
  OTHER_CURRENT_ASSET: 'OPERATING',
  TAX_RECOVERABLE: 'OPERATING',
  FIXED_ASSET: 'INVESTING',
  ACCUMULATED_DEPRECIATION: 'OPERATING',
  PAYABLE: 'OPERATING',
  TAX_PAYABLE: 'OPERATING',
  CUSTOMER_DEPOSIT: 'OPERATING',
  CREDIT_CARD: 'OPERATING',
  CURRENT_LIABILITY: 'OPERATING',
  FLOOR_PLAN: 'FINANCING',
  LONG_TERM_LIABILITY: 'FINANCING',
  EQUITY: 'FINANCING',
  RETAINED_EARNINGS: 'FINANCING',
  CURRENT_YEAR_EARNINGS: 'FINANCING',
};

// --- People and permissions ----------------------------------------------------

export const DEALER_STAFF_ROLES = [
  'OWNER',
  'MANAGER',
  'ACCOUNTANT',
  'SALES_MANAGER',
  'SALES_USER',
] as const;
export type DealerStaffRole = (typeof DEALER_STAFF_ROLES)[number];

export const DEALER_STAFF_ROLE_LABELS: Record<DealerStaffRole, string> = {
  OWNER: 'Dealer owner',
  MANAGER: 'Dealer manager',
  ACCOUNTANT: 'Accountant',
  SALES_MANAGER: 'Sales manager',
  SALES_USER: 'Salesperson',
};

export const ACCOUNTING_PERMISSIONS = [
  /** Financial statements, ledgers, the dashboard and every report. */
  'accounting.view',
  'accounting.create',
  'accounting.edit',
  'accounting.post',
  'accounting.reverse',
  'accounting.close_period',
  'accounting.reopen_period',
  'accounting.export',
  'accounting.manage_accounts',
  'accounting.manage_tax',
  'accounting.reconcile_bank',
  /** The deal desk: customers, deposits, trade-ins and draft deals. */
  'accounting.sales',
  /** Post (complete) a vehicle sale. */
  'accounting.post_sales',
  'accounting.manage_team',
  'accounting.settings',
] as const;
export type AccountingPermission = (typeof ACCOUNTING_PERMISSIONS)[number];

/**
 * What each staff role may do. A salesperson can work deals but sees no
 * financial reports: `accounting.view` is not theirs.
 */
export const STAFF_ROLE_PERMISSIONS: Record<DealerStaffRole, readonly AccountingPermission[]> = {
  OWNER: ACCOUNTING_PERMISSIONS,
  MANAGER: ACCOUNTING_PERMISSIONS.filter(
    (permission) =>
      permission !== 'accounting.reopen_period' && permission !== 'accounting.manage_team',
  ),
  ACCOUNTANT: ACCOUNTING_PERMISSIONS.filter(
    (permission) => permission !== 'accounting.manage_team',
  ),
  SALES_MANAGER: ['accounting.sales', 'accounting.post_sales'],
  SALES_USER: ['accounting.sales'],
};

export function staffCan(role: DealerStaffRole, permission: AccountingPermission): boolean {
  return STAFF_ROLE_PERMISSIONS[role].includes(permission);
}

// --- Transactions --------------------------------------------------------------

export const JOURNAL_SOURCES = [
  'MANUAL',
  'OPENING_BALANCE',
  'VEHICLE_ACQUISITION',
  'VEHICLE_COST',
  'VEHICLE_SALE',
  'CUSTOMER_DEPOSIT',
  'DEPOSIT_REFUND',
  'CUSTOMER_INVOICE',
  'CUSTOMER_PAYMENT',
  'CUSTOMER_REFUND',
  'VENDOR_BILL',
  'VENDOR_CREDIT',
  'VENDOR_PAYMENT',
  'EXPENSE',
  'BANK_TRANSACTION',
  'RECONCILIATION_ADJUSTMENT',
  'FLOOR_PLAN',
  'YEAR_END_CLOSE',
  'REVERSAL',
] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

export const JOURNAL_SOURCE_LABELS: Record<JournalSource, string> = {
  MANUAL: 'Manual entry',
  OPENING_BALANCE: 'Opening balance',
  VEHICLE_ACQUISITION: 'Vehicle purchase',
  VEHICLE_COST: 'Vehicle cost',
  VEHICLE_SALE: 'Vehicle sale',
  CUSTOMER_DEPOSIT: 'Customer deposit',
  DEPOSIT_REFUND: 'Deposit refund',
  CUSTOMER_INVOICE: 'Customer invoice',
  CUSTOMER_PAYMENT: 'Customer payment',
  CUSTOMER_REFUND: 'Customer refund',
  VENDOR_BILL: 'Vendor bill',
  VENDOR_CREDIT: 'Vendor credit',
  VENDOR_PAYMENT: 'Vendor payment',
  EXPENSE: 'Expense',
  BANK_TRANSACTION: 'Bank transaction',
  RECONCILIATION_ADJUSTMENT: 'Reconciliation adjustment',
  FLOOR_PLAN: 'Floor plan',
  YEAR_END_CLOSE: 'Year-end close',
  REVERSAL: 'Reversal',
};

export const JOURNAL_KINDS = ['STANDARD', 'ADJUSTING', 'OPENING', 'CLOSING', 'REVERSAL'] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

export const PAYMENT_METHODS = [
  'CASH',
  'CHEQUE',
  'DEBIT',
  'CREDIT_CARD',
  'E_TRANSFER',
  'BANK_TRANSFER',
  'FINANCING',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  DEBIT: 'Debit',
  CREDIT_CARD: 'Credit card',
  E_TRANSFER: 'E-transfer',
  BANK_TRANSFER: 'Bank transfer',
  FINANCING: 'Financing',
  OTHER: 'Other',
};

export const ACQUISITION_METHODS = [
  'AUCTION',
  'PRIVATE',
  'TRADE_IN',
  'DEALER',
  'WHOLESALE',
  'OTHER',
] as const;
export type AcquisitionMethod = (typeof ACQUISITION_METHODS)[number];

export const ACQUISITION_METHOD_LABELS: Record<AcquisitionMethod, string> = {
  AUCTION: 'Auction purchase',
  PRIVATE: 'Private purchase',
  TRADE_IN: 'Trade-in',
  DEALER: 'Dealer-to-dealer',
  WHOLESALE: 'Wholesale purchase',
  OTHER: 'Other acquisition',
};

/** How a purchase or bill is settled. */
export const SETTLEMENT_METHODS = ['PAID', 'ON_ACCOUNT', 'FLOOR_PLAN'] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

export const VENDOR_KINDS = [
  'AUCTION',
  'DEALER',
  'PRIVATE_SELLER',
  'SUPPLIER',
  'LENDER',
  'SERVICE',
  'GOVERNMENT',
  'OTHER',
] as const;
export type VendorKind = (typeof VENDOR_KINDS)[number];

export const VENDOR_KIND_LABELS: Record<VendorKind, string> = {
  AUCTION: 'Auction',
  DEALER: 'Dealer',
  PRIVATE_SELLER: 'Private seller',
  SUPPLIER: 'Supplier',
  LENDER: 'Lender',
  SERVICE: 'Service provider',
  GOVERNMENT: 'Government',
  OTHER: 'Other',
};

export const EXPENSE_TREATMENTS = ['OPERATING', 'VEHICLE_COST', 'COGS', 'CAPITAL'] as const;
export type ExpenseTreatment = (typeof EXPENSE_TREATMENTS)[number];

export const EXPENSE_TREATMENT_LABELS: Record<ExpenseTreatment, string> = {
  OPERATING: 'General dealership expense',
  VEHICLE_COST: 'Vehicle direct cost (added to inventory)',
  COGS: 'Cost of sales',
  CAPITAL: 'Capital purchase (fixed asset)',
};

export const RECURRENCE_FREQUENCIES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export const BANK_ACCOUNT_TYPES = [
  'CHEQUING',
  'SAVINGS',
  'CASH',
  'CREDIT_CARD',
  'LINE_OF_CREDIT',
] as const;
export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];

export const BANK_ACCOUNT_TYPE_LABELS: Record<BankAccountType, string> = {
  CHEQUING: 'Chequing',
  SAVINGS: 'Savings',
  CASH: 'Cash on hand',
  CREDIT_CARD: 'Credit card',
  LINE_OF_CREDIT: 'Line of credit',
};

export const BANK_TRANSACTION_KINDS = [
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER',
  'FEE',
  'ADJUSTMENT',
] as const;
export type BankTransactionKind = (typeof BANK_TRANSACTION_KINDS)[number];

export const DOCUMENT_STATUSES = ['DRAFT', 'POSTED', 'VOID'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const SETTLEMENT_STATUSES = ['OPEN', 'PARTIAL', 'PAID', 'VOID'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const DEPOSIT_STATUSES = ['OPEN', 'PARTIALLY_APPLIED', 'APPLIED', 'REFUNDED'] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

// --- Tax -------------------------------------------------------------------------

export const TAX_TYPES = ['GST', 'HST', 'PST', 'QST'] as const;
export type TaxType = (typeof TAX_TYPES)[number];

/**
 * What a line is, for tax purposes. A rule names the categories it taxes or
 * exempts; an amount in EXEMPT is never taxed.
 */
export const TAX_CATEGORIES = [
  'VEHICLE',
  'FEES',
  'ACCESSORIES',
  'WARRANTY',
  'PARTS',
  'SERVICE',
  'GENERAL',
  'EXEMPT',
] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

export const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  VEHICLE: 'Vehicle',
  FEES: 'Dealer and documentation fees',
  ACCESSORIES: 'Accessories',
  WARRANTY: 'Warranty',
  PARTS: 'Parts',
  SERVICE: 'Service',
  GENERAL: 'General goods and services',
  EXEMPT: 'Exempt',
};

export const TAX_RETURN_KINDS = ['GST_HST', 'PST', 'QST'] as const;
export type TaxReturnKind = (typeof TAX_RETURN_KINDS)[number];

export const TAX_RETURN_KIND_LABELS: Record<TaxReturnKind, string> = {
  GST_HST: 'GST/HST',
  PST: 'PST / RST',
  QST: 'QST',
};

/** Which return a tax type is filed on. */
export function returnKindFor(taxType: TaxType): TaxReturnKind {
  if (taxType === 'GST' || taxType === 'HST') return 'GST_HST';
  return taxType === 'QST' ? 'QST' : 'PST';
}

export const TAX_FILING_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;
export type TaxFilingFrequency = (typeof TAX_FILING_FREQUENCIES)[number];

export const TAX_FILING_STATUSES = ['OPEN', 'IN_REVIEW', 'FILED', 'CLOSED'] as const;
export type TaxFilingStatus = (typeof TAX_FILING_STATUSES)[number];

export const TAX_DISCLAIMER =
  'Tax rates and rules are configuration, not tax or legal advice. Confirm them with your accountant and the CRA, Revenu Québec or your provincial ministry of finance.';

// --- Reporting ---------------------------------------------------------------------

export const DATE_RANGE_PRESETS = [
  'TODAY',
  'THIS_WEEK',
  'THIS_MONTH',
  'LAST_MONTH',
  'THIS_QUARTER',
  'YEAR_TO_DATE',
  'CURRENT_FISCAL_YEAR',
  'PREVIOUS_FISCAL_YEAR',
  'CUSTOM',
] as const;
export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

export const DATE_RANGE_PRESET_LABELS: Record<DateRangePreset, string> = {
  TODAY: 'Today',
  THIS_WEEK: 'This week',
  THIS_MONTH: 'This month',
  LAST_MONTH: 'Last month',
  THIS_QUARTER: 'Quarter',
  YEAR_TO_DATE: 'Year to date',
  CURRENT_FISCAL_YEAR: 'Current fiscal year',
  PREVIOUS_FISCAL_YEAR: 'Previous fiscal year',
  CUSTOM: 'Custom range',
};

export const AGING_BUCKETS = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  CURRENT: 'Current',
  D1_30: '1–30',
  D31_60: '31–60',
  D61_90: '61–90',
  D90_PLUS: '90+',
};

export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORTABLE_REPORTS = [
  'general-ledger',
  'trial-balance',
  'profit-loss',
  'balance-sheet',
  'cash-flow',
  'tax',
  'ar-aging',
  'ap-aging',
  'inventory-valuation',
  'vehicle-profitability',
  'journal-entries',
  'expenses',
  'reconciliation',
  'kpis',
  'monthly',
] as const;
export type ExportableReport = (typeof EXPORTABLE_REPORTS)[number];

// --- Money -------------------------------------------------------------------------

const MONEY_PATTERN = /^(-)?(\d{1,13})(?:\.(\d{1,2}))?$/;

/**
 * "1,234.5" → 123450. Exact: works on the digits, never multiplies a float.
 * Returns null for anything that is not a plain amount with at most two
 * decimals (so 1.005 is refused rather than silently rounded).
 */
export function parseMoneyToCents(value: string | number): number | null {
  const text = (typeof value === 'number' ? String(value) : value).trim().replace(/[$,\s]/g, '');
  const match = MONEY_PATTERN.exec(text);
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return sign ? -cents : cents;
}

/** 123450 → "1234.50" (no grouping, for inputs and exports). */
export function centsToDecimalString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/** 123450 → "$1,234.50"; negatives in parentheses, as statements print them. */
export function formatLedgerCents(cents: number, options: { parentheses?: boolean } = {}): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-CA');
  const text = `$${whole}.${String(abs % 100).padStart(2, '0')}`;
  if (!negative) return text;
  return options.parentheses === false ? `-${text}` : `(${text})`;
}

/** A rate stored as a percentage string ("9.975") for display. */
export function formatRate(rate: string | number): string {
  const value = typeof rate === 'number' ? rate : Number(rate);
  return `${Number(value.toFixed(5))}%`;
}
