import { SUBTYPE_TYPE, type AccountSubtype } from '@vintrax/shared';

/**
 * The default chart of accounts for a Canadian automotive dealership.
 *
 * Posting rules never refer to an account by code or name — a dealer may
 * renumber or rename — but by `systemKey`. Accounts without a key are
 * defaults a dealer may rename, deactivate or ignore.
 */
export const SYSTEM_KEYS = [
  'CASH',
  'AR',
  'VEHICLE_INVENTORY',
  'PARTS_INVENTORY',
  'ACCESSORIES_INVENTORY',
  'GST_HST_RECOVERABLE',
  'PST_RECOVERABLE',
  'QST_RECOVERABLE',
  'FIXED_ASSETS',
  'AP',
  'CUSTOMER_DEPOSITS',
  'GST_HST_PAYABLE',
  'PST_PAYABLE',
  'QST_PAYABLE',
  'FLOOR_PLAN',
  'OWNER_EQUITY',
  'RETAINED_EARNINGS',
  'CURRENT_YEAR_EARNINGS',
  'VEHICLE_SALES',
  'USED_VEHICLE_SALES',
  'NEW_VEHICLE_SALES',
  'WHOLESALE_VEHICLE_SALES',
  'ACCESSORIES_SALES',
  'WARRANTY_REVENUE',
  'FINANCE_REVENUE',
  'EXTENDED_WARRANTY_REVENUE',
  'FEE_REVENUE',
  'OTHER_REVENUE',
  'VEHICLE_COGS',
  'WHOLESALE_COGS',
  'RECONDITIONING_COST',
  'AUCTION_FEES',
  'TRANSPORTATION_COST',
  'OTHER_DIRECT_COSTS',
  'ADVERTISING',
  'BANK_FEES',
  'INTEREST_EXPENSE',
  'MISC_EXPENSE',
] as const;
export type SystemKey = (typeof SYSTEM_KEYS)[number];

export interface DefaultAccount {
  code: string;
  name: string;
  subtype: AccountSubtype;
  systemKey?: SystemKey;
  description?: string;
}

export const DEFAULT_CHART: readonly DefaultAccount[] = [
  // Assets
  {
    code: '1000',
    name: 'Cash',
    subtype: 'CASH',
    systemKey: 'CASH',
    description: 'Cash on hand and the cash drawer.',
  },
  { code: '1100', name: 'Accounts Receivable', subtype: 'RECEIVABLE', systemKey: 'AR' },
  {
    code: '1150',
    name: 'Customer Deposits Receivable',
    subtype: 'OTHER_CURRENT_ASSET',
    description: 'Deposits a customer has committed to but not yet paid.',
  },
  { code: '1200', name: 'Vehicle Inventory', subtype: 'INVENTORY', systemKey: 'VEHICLE_INVENTORY' },
  { code: '1210', name: 'Parts Inventory', subtype: 'INVENTORY', systemKey: 'PARTS_INVENTORY' },
  {
    code: '1220',
    name: 'Accessories Inventory',
    subtype: 'INVENTORY',
    systemKey: 'ACCESSORIES_INVENTORY',
  },
  { code: '1300', name: 'Prepaid Expenses', subtype: 'OTHER_CURRENT_ASSET' },
  {
    code: '1400',
    name: 'GST/HST Recoverable',
    subtype: 'TAX_RECOVERABLE',
    systemKey: 'GST_HST_RECOVERABLE',
    description: 'Input tax credits on GST/HST paid.',
  },
  {
    code: '1410',
    name: 'PST Recoverable',
    subtype: 'TAX_RECOVERABLE',
    systemKey: 'PST_RECOVERABLE',
  },
  {
    code: '1420',
    name: 'QST Recoverable',
    subtype: 'TAX_RECOVERABLE',
    systemKey: 'QST_RECOVERABLE',
    description: 'Input tax refunds on QST paid.',
  },
  { code: '1500', name: 'Fixed Assets', subtype: 'FIXED_ASSET', systemKey: 'FIXED_ASSETS' },
  { code: '1510', name: 'Equipment', subtype: 'FIXED_ASSET' },
  { code: '1520', name: 'Computer Equipment', subtype: 'FIXED_ASSET' },
  { code: '1590', name: 'Accumulated Depreciation', subtype: 'ACCUMULATED_DEPRECIATION' },

  // Liabilities
  { code: '2000', name: 'Accounts Payable', subtype: 'PAYABLE', systemKey: 'AP' },
  {
    code: '2100',
    name: 'Customer Deposits Liability',
    subtype: 'CUSTOMER_DEPOSIT',
    systemKey: 'CUSTOMER_DEPOSITS',
    description: 'Deposits received and not yet applied to a sale or refunded.',
  },
  { code: '2200', name: 'GST/HST Payable', subtype: 'TAX_PAYABLE', systemKey: 'GST_HST_PAYABLE' },
  { code: '2210', name: 'PST Payable', subtype: 'TAX_PAYABLE', systemKey: 'PST_PAYABLE' },
  { code: '2220', name: 'QST Payable', subtype: 'TAX_PAYABLE', systemKey: 'QST_PAYABLE' },
  { code: '2300', name: 'Payroll Liabilities', subtype: 'CURRENT_LIABILITY' },
  { code: '2400', name: 'Floor Plan Financing', subtype: 'FLOOR_PLAN', systemKey: 'FLOOR_PLAN' },
  { code: '2500', name: 'Loans Payable', subtype: 'LONG_TERM_LIABILITY' },
  { code: '2900', name: 'Other Liabilities', subtype: 'CURRENT_LIABILITY' },

  // Equity
  {
    code: '3000',
    name: 'Owner Equity',
    subtype: 'EQUITY',
    systemKey: 'OWNER_EQUITY',
    description: 'Owner contributions and the offset for opening balances.',
  },
  { code: '3100', name: 'Share Capital', subtype: 'EQUITY' },
  {
    code: '3200',
    name: 'Retained Earnings',
    subtype: 'RETAINED_EARNINGS',
    systemKey: 'RETAINED_EARNINGS',
  },
  {
    code: '3300',
    name: 'Current Year Earnings',
    subtype: 'CURRENT_YEAR_EARNINGS',
    systemKey: 'CURRENT_YEAR_EARNINGS',
    description: 'Calculated from the profit and loss accounts; nothing posts here directly.',
  },

  // Revenue
  { code: '4000', name: 'Vehicle Sales', subtype: 'OPERATING_REVENUE', systemKey: 'VEHICLE_SALES' },
  {
    code: '4010',
    name: 'Used Vehicle Sales',
    subtype: 'OPERATING_REVENUE',
    systemKey: 'USED_VEHICLE_SALES',
  },
  {
    code: '4020',
    name: 'New Vehicle Sales',
    subtype: 'OPERATING_REVENUE',
    systemKey: 'NEW_VEHICLE_SALES',
  },
  {
    code: '4030',
    name: 'Wholesale Vehicle Sales',
    subtype: 'OPERATING_REVENUE',
    systemKey: 'WHOLESALE_VEHICLE_SALES',
  },
  { code: '4100', name: 'Parts Sales', subtype: 'OPERATING_REVENUE' },
  {
    code: '4110',
    name: 'Accessories Sales',
    subtype: 'OPERATING_REVENUE',
    systemKey: 'ACCESSORIES_SALES',
  },
  { code: '4200', name: 'Service Revenue', subtype: 'OPERATING_REVENUE' },
  {
    code: '4300',
    name: 'Warranty Revenue',
    subtype: 'OPERATING_REVENUE',
    systemKey: 'WARRANTY_REVENUE',
  },
  {
    code: '4400',
    name: 'Finance Revenue',
    subtype: 'OPERATING_REVENUE',
    systemKey: 'FINANCE_REVENUE',
  },
  {
    code: '4410',
    name: 'Extended Warranty Revenue',
    subtype: 'OPERATING_REVENUE',
    systemKey: 'EXTENDED_WARRANTY_REVENUE',
  },
  {
    code: '4500',
    name: 'Dealer & Documentation Fees',
    subtype: 'OPERATING_REVENUE',
    systemKey: 'FEE_REVENUE',
  },
  { code: '4900', name: 'Other Revenue', subtype: 'OPERATING_REVENUE', systemKey: 'OTHER_REVENUE' },
  { code: '4950', name: 'Interest & Other Income', subtype: 'OTHER_INCOME' },

  // Cost of sales
  {
    code: '5000',
    name: 'Vehicle Cost of Sales',
    subtype: 'COST_OF_SALES',
    systemKey: 'VEHICLE_COGS',
  },
  {
    code: '5010',
    name: 'Wholesale Vehicle Cost',
    subtype: 'COST_OF_SALES',
    systemKey: 'WHOLESALE_COGS',
  },
  { code: '5100', name: 'Parts Cost', subtype: 'COST_OF_SALES' },
  { code: '5110', name: 'Accessories Cost', subtype: 'COST_OF_SALES' },
  {
    code: '5200',
    name: 'Reconditioning Cost',
    subtype: 'COST_OF_SALES',
    systemKey: 'RECONDITIONING_COST',
  },
  { code: '5210', name: 'Auction Fees', subtype: 'COST_OF_SALES', systemKey: 'AUCTION_FEES' },
  {
    code: '5220',
    name: 'Transportation Cost',
    subtype: 'COST_OF_SALES',
    systemKey: 'TRANSPORTATION_COST',
  },
  {
    code: '5290',
    name: 'Other Direct Vehicle Costs',
    subtype: 'COST_OF_SALES',
    systemKey: 'OTHER_DIRECT_COSTS',
  },

  // Operating expenses
  { code: '6000', name: 'Advertising', subtype: 'OPERATING_EXPENSE', systemKey: 'ADVERTISING' },
  { code: '6010', name: 'Marketing', subtype: 'OPERATING_EXPENSE' },
  { code: '6100', name: 'Rent', subtype: 'OPERATING_EXPENSE' },
  { code: '6110', name: 'Utilities', subtype: 'OPERATING_EXPENSE' },
  { code: '6120', name: 'Insurance', subtype: 'OPERATING_EXPENSE' },
  { code: '6130', name: 'Telephone', subtype: 'OPERATING_EXPENSE' },
  { code: '6140', name: 'Internet', subtype: 'OPERATING_EXPENSE' },
  { code: '6150', name: 'Software', subtype: 'OPERATING_EXPENSE' },
  { code: '6160', name: 'Office Expenses', subtype: 'OPERATING_EXPENSE' },
  { code: '6170', name: 'Repairs', subtype: 'OPERATING_EXPENSE' },
  { code: '6200', name: 'Professional Fees', subtype: 'OPERATING_EXPENSE' },
  { code: '6210', name: 'Accounting Fees', subtype: 'OPERATING_EXPENSE' },
  { code: '6220', name: 'Legal Fees', subtype: 'OPERATING_EXPENSE' },
  { code: '6300', name: 'Bank Fees', subtype: 'OPERATING_EXPENSE', systemKey: 'BANK_FEES' },
  { code: '6310', name: 'Interest', subtype: 'OTHER_EXPENSE', systemKey: 'INTEREST_EXPENSE' },
  { code: '6400', name: 'Payroll', subtype: 'OPERATING_EXPENSE' },
  { code: '6410', name: 'Commission', subtype: 'OPERATING_EXPENSE' },
  { code: '6500', name: 'Fuel', subtype: 'OPERATING_EXPENSE' },
  { code: '6510', name: 'Registration', subtype: 'OPERATING_EXPENSE' },
  { code: '6520', name: 'Cleaning', subtype: 'OPERATING_EXPENSE' },
  { code: '6530', name: 'Detailing', subtype: 'OPERATING_EXPENSE' },
  { code: '6540', name: 'Security', subtype: 'OPERATING_EXPENSE' },
  { code: '6600', name: 'Depreciation', subtype: 'OPERATING_EXPENSE' },
  { code: '6900', name: 'Miscellaneous', subtype: 'OPERATING_EXPENSE', systemKey: 'MISC_EXPENSE' },
];

export function typeOf(subtype: AccountSubtype) {
  return SUBTYPE_TYPE[subtype];
}

/**
 * Which cost-of-sales account a vehicle cost category's share of COGS is
 * reported under is not needed: inventory is relieved as one amount to
 * Vehicle Cost of Sales, and the per-category split stays on the inventory
 * lines' `costCategory`, which the KPIs read.
 */
export const RECONDITIONING_CATEGORIES = [
  'MECHANICAL_REPAIR',
  'BODY_REPAIR',
  'DETAILING',
  'PARTS',
  'TIRES',
  'CERTIFICATION',
] as const;
