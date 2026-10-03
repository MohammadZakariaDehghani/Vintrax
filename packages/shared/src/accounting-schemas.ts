import { z } from 'zod';
import {
  ACCOUNT_SUBTYPES,
  ACQUISITION_METHODS,
  BANK_ACCOUNT_TYPES,
  BANK_TRANSACTION_KINDS,
  DATE_RANGE_PRESETS,
  DEALER_STAFF_ROLES,
  EXPENSE_TREATMENTS,
  EXPORTABLE_REPORTS,
  JOURNAL_SOURCES,
  PAYMENT_METHODS,
  RECURRENCE_FREQUENCIES,
  SETTLEMENT_METHODS,
  TAX_CATEGORIES,
  TAX_FILING_FREQUENCIES,
  TAX_FILING_STATUSES,
  TAX_RETURN_KINDS,
  TAX_TYPES,
  VENDOR_KINDS,
  centsToDecimalString,
  parseMoneyToCents,
} from './accounting';
import { VEHICLE_COST_CATEGORIES } from './dealer-portal';
import {
  BODY_TYPES,
  DRIVETRAINS,
  FUEL_TYPES,
  MIN_MODEL_YEAR,
  PROVINCES,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
  maxModelYear,
} from './domain';

/**
 * Inputs to the accounting API. Every amount is parsed to integer cents here,
 * so the services never see a float; every date is a calendar date
 * (YYYY-MM-DD), because accounting periods are days, not instants.
 */

/** Largest single amount accepted: $10 billion. */
const MAX_CENTS = 1_000_000_000_000;

const amount = (options: { allowNegative?: boolean; allowZero?: boolean } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      const cents = parseMoneyToCents(value);
      if (cents === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter an amount like 1234.56' });
        return z.NEVER;
      }
      if (!options.allowNegative && cents < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The amount cannot be negative' });
        return z.NEVER;
      }
      if (!options.allowZero && cents === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The amount must be more than zero' });
        return z.NEVER;
      }
      if (Math.abs(cents) > MAX_CENTS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The amount is too large' });
        return z.NEVER;
      }
      return cents;
    });

/** A positive amount. */
export const moneyInput = amount();
/** Zero or more; blank means zero. */
export const optionalMoneyInput = z
  .union([z.literal(''), z.string(), z.number()])
  .optional()
  .transform((value) => (value === undefined || value === '' ? '0' : value))
  .pipe(amount({ allowZero: true }));
/** Any sign, e.g. an opening balance or a statement balance. */
export const signedMoneyInput = amount({ allowNegative: true, allowZero: true });

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const dateInput = z
  .string()
  .regex(DATE_PATTERN, 'Use a date like 2026-04-30')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'That date does not exist');

const id = () => z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => z.string().trim().min(1).max(max);
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

/** A percentage with up to five decimals, kept as a string so it stays exact. */
export const rateInput = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d{1,3}(\.\d{1,5})?$/.test(value), 'Enter a rate like 5 or 9.975')
  .refine((value) => Number(value) <= 100, 'A rate is at most 100%');

/**
 * A payment reference: a cheque number, an e-transfer reference, the last four
 * digits of a card. Anything that looks like a full card number (13–19 digits,
 * with or without spaces or dashes) is refused — Vintrax never stores one.
 */
export const paymentReferenceInput = z
  .string()
  .trim()
  .max(60)
  .optional()
  .nullable()
  .refine(
    (value) => !value || !/(?:\d[ -]?){13,19}/.test(value),
    'Do not enter a full card or account number. Use the last four digits only.',
  )
  .transform((value) => (value ? value : null));

const province = z.enum(PROVINCES);
const paymentMethod = z.enum(PAYMENT_METHODS);
const taxCategory = z.enum(TAX_CATEGORIES);

// --- Setup and settings -------------------------------------------------------------

export const accountingSetupSchema = z.object({
  legalName: requiredText(160),
  businessNumber: optionalText(30),
  gstHstNumber: optionalText(30),
  pstNumber: optionalText(30),
  qstNumber: optionalText(30),
  province,
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  fiscalYearStartDay: z.coerce.number().int().min(1).max(28).default(1),
  taxFilingFrequency: z.enum(TAX_FILING_FREQUENCIES).default('QUARTERLY'),
  /** Create a chequing account and a cash drawer with these opening balances. */
  openingBank: z
    .object({
      name: requiredText(80).default('Operating chequing'),
      bankName: optionalText(80),
      accountNumberLast4: z
        .string()
        .regex(/^\d{4}$/, 'Four digits')
        .optional()
        .nullable()
        .transform((value) => value ?? null),
      openingBalance: signedMoneyInput.default(0),
    })
    .optional(),
});
export type AccountingSetupInput = z.infer<typeof accountingSetupSchema>;

export const accountingSettingsSchema = z
  .object({
    legalName: requiredText(160),
    businessNumber: optionalText(30),
    gstHstNumber: optionalText(30),
    pstNumber: optionalText(30),
    qstNumber: optionalText(30),
    province,
    fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
    fiscalYearStartDay: z.coerce.number().int().min(1).max(28),
    taxFilingFrequency: z.enum(TAX_FILING_FREQUENCIES),
    defaultBankAccountId: optionalId(),
    invoicePrefix: text(10),
    journalPrefix: text(10),
    nextInvoiceNumber: z.coerce.number().int().min(1).max(99_999_999),
    nextJournalNumber: z.coerce.number().int().min(1).max(99_999_999),
    allowNegativeInventory: z.boolean(),
  })
  .partial();
export type AccountingSettingsInput = z.infer<typeof accountingSettingsSchema>;

export const staffMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(DEALER_STAFF_ROLES).refine((role) => role !== 'OWNER', 'There is one owner'),
});
export type StaffMemberInput = z.infer<typeof staffMemberSchema>;

export const staffRoleSchema = z.object({
  role: z.enum(DEALER_STAFF_ROLES).refine((role) => role !== 'OWNER', 'There is one owner'),
});

// --- Chart of accounts ----------------------------------------------------------------

export const accountCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z][0-9A-Za-z.-]{1,11}$/, 'Use 2–12 letters, digits, dots or dashes'),
  name: requiredText(100),
  subtype: z.enum(ACCOUNT_SUBTYPES),
  parentId: optionalId(),
  description: optionalText(300),
});
export type AccountCreateInput = z.infer<typeof accountCreateSchema>;

export const accountUpdateSchema = z
  .object({
    name: requiredText(100),
    description: optionalText(300),
    isActive: z.boolean(),
    parentId: optionalId(),
  })
  .partial();
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;

// --- Journal ----------------------------------------------------------------------------

export const journalLineInputSchema = z
  .object({
    accountId: id(),
    debit: optionalMoneyInput,
    credit: optionalMoneyInput,
    description: optionalText(200),
    vehicleId: optionalId(),
    customerId: optionalId(),
    vendorId: optionalId(),
  })
  .refine((line) => (line.debit > 0) !== (line.credit > 0), {
    message: 'Each line is either a debit or a credit',
    path: ['debit'],
  });
export type JournalLineInput = z.infer<typeof journalLineInputSchema>;

export const journalCreateSchema = z
  .object({
    date: dateInput,
    description: requiredText(200),
    memo: optionalText(2000),
    kind: z.enum(['STANDARD', 'ADJUSTING', 'OPENING']).default('STANDARD'),
    lines: z.array(journalLineInputSchema).min(2).max(200),
    /** Post now (needs accounting.post) or keep as a draft. */
    post: z.boolean().default(false),
  })
  .refine(
    (entry) =>
      entry.lines.reduce((sum, line) => sum + line.debit, 0) ===
      entry.lines.reduce((sum, line) => sum + line.credit, 0),
    { message: 'Debits must equal credits', path: ['lines'] },
  );
export type JournalCreateInput = z.infer<typeof journalCreateSchema>;

export const journalReverseSchema = z.object({
  /** Defaults to the original date when its period is open, else today. */
  date: dateInput.optional(),
  reason: requiredText(300),
});
export type JournalReverseInput = z.infer<typeof journalReverseSchema>;

export const reasonSchema = z.object({ reason: requiredText(300) });
export const optionalReasonSchema = z.object({ reason: optionalText(300) });

export const yearEndCloseSchema = z.object({
  confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm the year-end close' }) }),
  reason: optionalText(300),
});

// --- Tax ---------------------------------------------------------------------------------

export const taxRuleCreateSchema = z
  .object({
    province,
    taxType: z.enum(TAX_TYPES),
    name: requiredText(100),
    rate: rateInput,
    effectiveFrom: dateInput,
    effectiveTo: dateInput.optional().nullable(),
    taxIncluded: z.boolean().default(false),
    taxableCategories: z.array(taxCategory).max(10).default([]),
    exemptCategories: z.array(taxCategory).max(10).default([]),
    minPriceCents: z.coerce.number().int().min(0).optional().nullable(),
    maxPriceCents: z.coerce.number().int().min(0).optional().nullable(),
    tradeInReducesBase: z.boolean().default(true),
    recoverable: z.boolean().default(true),
    source: requiredText(500),
    notes: optionalText(500),
  })
  .refine((rule) => !rule.effectiveTo || rule.effectiveTo >= rule.effectiveFrom, {
    message: 'The end date is before the start date',
    path: ['effectiveTo'],
  });
export type TaxRuleCreateInput = z.infer<typeof taxRuleCreateSchema>;

/** A new version of a rule from a date: the old one ends the day before. */
export const taxRuleSupersedeSchema = z.object({
  rate: rateInput,
  effectiveFrom: dateInput,
  source: requiredText(500),
  notes: optionalText(500),
});
export type TaxRuleSupersedeInput = z.infer<typeof taxRuleSupersedeSchema>;

export const taxRuleStatusSchema = z.object({ isActive: z.boolean() });

export const taxQuoteSchema = z.object({
  province,
  date: dateInput,
  lines: z
    .array(z.object({ category: taxCategory, amount: optionalMoneyInput }))
    .min(1)
    .max(30),
  tradeIn: optionalMoneyInput,
  vehiclePrice: optionalMoneyInput,
});
export type TaxQuoteInput = z.infer<typeof taxQuoteSchema>;

export const taxFilingCreateSchema = z
  .object({
    kind: z.enum(TAX_RETURN_KINDS),
    startDate: dateInput,
    endDate: dateInput,
    frequency: z.enum([...TAX_FILING_FREQUENCIES, 'CUSTOM']).default('CUSTOM'),
  })
  .refine((filing) => filing.endDate >= filing.startDate, {
    message: 'The end date is before the start date',
    path: ['endDate'],
  });
export type TaxFilingCreateInput = z.infer<typeof taxFilingCreateSchema>;

export const taxFilingUpdateSchema = z
  .object({
    status: z.enum(TAX_FILING_STATUSES),
    adjustments: signedMoneyInput,
    confirmationNumber: optionalText(60),
    notes: optionalText(2000),
  })
  .partial();
export type TaxFilingUpdateInput = z.infer<typeof taxFilingUpdateSchema>;

// --- Parties --------------------------------------------------------------------------------

export const customerSchema = z.object({
  name: requiredText(160),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(254)
    .optional()
    .nullable()
    .or(z.literal(''))
    .transform((value) => (value ? value : null)),
  phone: optionalText(30),
  address: optionalText(200),
  city: optionalText(80),
  province: province.optional().nullable(),
  postalCode: optionalText(10),
  userId: optionalId(),
  notes: optionalText(2000),
});
export type CustomerInput = z.infer<typeof customerSchema>;
export const customerUpdateSchema = customerSchema
  .partial()
  .extend({ isActive: z.boolean().optional() });

export const vendorSchema = z.object({
  name: requiredText(160),
  kind: z.enum(VENDOR_KINDS).default('SUPPLIER'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(254)
    .optional()
    .nullable()
    .or(z.literal(''))
    .transform((value) => (value ? value : null)),
  phone: optionalText(30),
  address: optionalText(200),
  province: province.optional().nullable(),
  gstNumber: optionalText(30),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  notes: optionalText(2000),
});
export type VendorInput = z.infer<typeof vendorSchema>;
export const vendorUpdateSchema = vendorSchema.partial().extend({ isActive: z.boolean().optional() });

// --- Inventory --------------------------------------------------------------------------------

export const floorPlanTermsSchema = z.object({
  lenderVendorId: id(),
  /** Defaults to the full purchase price. */
  principal: optionalMoneyInput,
  interestRate: rateInput,
  maturityDate: dateInput.optional().nullable(),
  reference: optionalText(60),
});

export const acquisitionSchema = z
  .object({
    vehicleId: id(),
    method: z.enum(ACQUISITION_METHODS).refine((m) => m !== 'TRADE_IN', {
      message: 'Record a trade-in from the deal',
    }),
    vendorId: optionalId(),
    date: dateInput,
    purchasePrice: moneyInput,
    auctionFee: optionalMoneyInput,
    transportation: optionalMoneyInput,
    inspection: optionalMoneyInput,
    reconditioning: optionalMoneyInput,
    otherCosts: optionalMoneyInput,
    /** The vendor is a GST/HST registrant and charged tax on the invoice. */
    vendorChargedTax: z.boolean().default(false),
    settlement: z.enum(SETTLEMENT_METHODS),
    paymentMethod: paymentMethod.optional().nullable(),
    bankAccountId: optionalId(),
    dueDate: dateInput.optional().nullable(),
    floorPlan: floorPlanTermsSchema.optional().nullable(),
    reference: paymentReferenceInput,
    notes: optionalText(2000),
  })
  .refine((input) => input.settlement !== 'PAID' || input.bankAccountId, {
    message: 'Choose the account it was paid from',
    path: ['bankAccountId'],
  })
  .refine((input) => input.settlement !== 'ON_ACCOUNT' || input.vendorId, {
    message: 'A purchase on account needs a vendor',
    path: ['vendorId'],
  })
  .refine((input) => input.settlement !== 'FLOOR_PLAN' || input.floorPlan, {
    message: 'Enter the floor plan terms',
    path: ['floorPlan'],
  });
export type AcquisitionInput = z.infer<typeof acquisitionSchema>;

export const tradeInSchema = z
  .object({
    customerId: id(),
    /** An existing draft vehicle; otherwise one is created from the details. */
    vehicleId: optionalId(),
    vin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'A VIN is 17 letters and digits, without I, O or Q')
      .optional()
      .nullable()
      .or(z.literal(''))
      .transform((value) => (value ? value : null)),
    year: z.coerce.number().int().min(MIN_MODEL_YEAR).max(maxModelYear()),
    make: requiredText(60),
    model: requiredText(60),
    trim: optionalText(60),
    mileageKm: z.coerce.number().int().min(0).max(2_000_000),
    bodyType: z.enum(BODY_TYPES).default('SEDAN'),
    transmission: z.enum(TRANSMISSIONS).default('AUTOMATIC'),
    fuelType: z.enum(FUEL_TYPES).default('GASOLINE'),
    drivetrain: z.enum(DRIVETRAINS).default('FWD'),
    condition: z.enum(VEHICLE_CONDITIONS).default('USED'),
    appraisedValue: optionalMoneyInput,
    tradeAllowance: moneyInput,
    lienPayoff: optionalMoneyInput,
    lienHolderVendorId: optionalId(),
    notes: optionalText(2000),
  })
  .refine((input) => input.lienPayoff === 0 || input.lienHolderVendorId, {
    message: 'Choose the lender being paid off',
    path: ['lienHolderVendorId'],
  });
export type TradeInInput = z.infer<typeof tradeInSchema>;

// --- Sales and deposits ----------------------------------------------------------------------

export const depositApplicationSchema = z.object({ depositId: id(), amount: moneyInput });

export const saleSchema = z
  .object({
    vehicleId: id(),
    customerId: id(),
    salespersonId: optionalId(),
    saleDate: dateInput,
    salePrice: moneyInput,
    discount: optionalMoneyInput,
    documentationFee: optionalMoneyInput,
    dealerFees: optionalMoneyInput,
    accessories: optionalMoneyInput,
    warranty: optionalMoneyInput,
    otherCharges: optionalMoneyInput,
    financeRevenue: optionalMoneyInput,
    financeLenderVendorId: optionalId(),
    tradeInId: optionalId(),
    deposits: z.array(depositApplicationSchema).max(10).default([]),
    downPayment: optionalMoneyInput,
    downPaymentMethod: paymentMethod.optional().nullable(),
    bankAccountId: optionalId(),
    financedAmount: optionalMoneyInput,
    /** Where the vehicle is delivered; defaults to the dealer's province. */
    taxProvince: province.optional().nullable(),
    dueDate: dateInput.optional().nullable(),
    notes: optionalText(2000),
  })
  .refine((sale) => sale.discount <= sale.salePrice, {
    message: 'The discount is larger than the price',
    path: ['discount'],
  })
  .refine((sale) => sale.downPayment === 0 || sale.bankAccountId, {
    message: 'Choose the account the down payment went into',
    path: ['bankAccountId'],
  })
  .refine(
    (sale) => (sale.financedAmount === 0 && sale.financeRevenue === 0) || sale.financeLenderVendorId,
    { message: 'Choose the finance lender', path: ['financeLenderVendorId'] },
  );
export type SaleInput = z.infer<typeof saleSchema>;

const SALE_MONEY_FIELDS = [
  'salePrice',
  'discount',
  'documentationFee',
  'dealerFees',
  'accessories',
  'warranty',
  'otherCharges',
  'financeRevenue',
  'downPayment',
  'financedAmount',
] as const;

/**
 * A parsed sale back in the shape a person types (amounts as "1234.50"), so a
 * saved draft can be reopened in the form and re-validated by `saleSchema`
 * without its cents being read as dollars.
 */
export function saleInputToForm(input: SaleInput): Record<string, unknown> {
  const form: Record<string, unknown> = { ...input };
  for (const field of SALE_MONEY_FIELDS) form[field] = centsToDecimalString(input[field]);
  form['deposits'] = input.deposits.map((deposit) => ({
    depositId: deposit.depositId,
    amount: centsToDecimalString(deposit.amount),
  }));
  return form;
}

export const depositSchema = z.object({
  customerId: id(),
  vehicleId: optionalId(),
  date: dateInput,
  amount: moneyInput,
  method: paymentMethod,
  bankAccountId: id(),
  reference: paymentReferenceInput,
  notes: optionalText(2000),
});
export type DepositInput = z.infer<typeof depositSchema>;

export const depositRefundSchema = z.object({
  amount: moneyInput,
  date: dateInput,
  bankAccountId: id(),
  reason: requiredText(300),
});
export type DepositRefundInput = z.infer<typeof depositRefundSchema>;

// --- Receivables, payables, payments --------------------------------------------------------

export const invoiceSchema = z
  .object({
    customerId: id(),
    date: dateInput,
    dueDate: dateInput,
    description: optionalText(200),
    taxProvince: province.optional().nullable(),
    lines: z
      .array(
        z.object({
          accountId: id(),
          description: requiredText(200),
          amount: moneyInput,
          taxCategory: taxCategory.default('GENERAL'),
        }),
      )
      .min(1)
      .max(50),
  })
  .refine((invoice) => invoice.dueDate >= invoice.date, {
    message: 'The due date is before the invoice date',
    path: ['dueDate'],
  });
export type InvoiceInput = z.infer<typeof invoiceSchema>;

export const billSchema = z
  .object({
    vendorId: id(),
    kind: z.enum(['BILL', 'CREDIT_NOTE']).default('BILL'),
    vendorReference: optionalText(60),
    date: dateInput,
    dueDate: dateInput,
    /** The vendor charged sales tax: GST/HST/QST is recoverable, PST is a cost. */
    vendorChargedTax: z.boolean().default(true),
    taxProvince: province.optional().nullable(),
    lines: z
      .array(
        z.object({
          accountId: id(),
          description: requiredText(200),
          amount: moneyInput,
          vehicleId: optionalId(),
          costCategory: z.enum(VEHICLE_COST_CATEGORIES).optional().nullable(),
          taxCategory: taxCategory.default('GENERAL'),
        }),
      )
      .min(1)
      .max(50),
    notes: optionalText(2000),
  })
  .refine((bill) => bill.dueDate >= bill.date, {
    message: 'The due date is before the bill date',
    path: ['dueDate'],
  });
export type BillInput = z.infer<typeof billSchema>;

export const paymentSchema = z
  .object({
    direction: z.enum(['RECEIVED', 'SENT']),
    kind: z.enum(['PAYMENT', 'REFUND']).default('PAYMENT'),
    customerId: optionalId(),
    vendorId: optionalId(),
    date: dateInput,
    amount: moneyInput,
    method: paymentMethod,
    reference: paymentReferenceInput,
    bankAccountId: id(),
    allocations: z
      .array(z.object({ invoiceId: optionalId(), billId: optionalId(), amount: moneyInput }))
      .max(50)
      .default([]),
    notes: optionalText(2000),
  })
  .refine((p) => (p.customerId ? 1 : 0) + (p.vendorId ? 1 : 0) === 1, {
    message: 'A payment is with either a customer or a vendor',
    path: ['customerId'],
  })
  .refine(
    (p) => p.allocations.reduce((sum, allocation) => sum + allocation.amount, 0) <= p.amount,
    { message: 'The allocations add up to more than the payment', path: ['allocations'] },
  );
export type PaymentInput = z.infer<typeof paymentSchema>;

// --- Expenses -----------------------------------------------------------------------------------

export const expenseSchema = z
  .object({
    date: dateInput,
    vendorId: optionalId(),
    accountId: id(),
    treatment: z.enum(EXPENSE_TREATMENTS).default('OPERATING'),
    vehicleId: optionalId(),
    costCategory: z.enum(VEHICLE_COST_CATEGORIES).optional().nullable(),
    description: requiredText(200),
    amount: moneyInput,
    /** Apply sales tax at the configured rates (recoverable parts go to ITCs). */
    applyTax: z.boolean().default(false),
    taxCategory: taxCategory.default('GENERAL'),
    taxProvince: province.optional().nullable(),
    method: paymentMethod,
    bankAccountId: id(),
    reference: paymentReferenceInput,
    notes: optionalText(2000),
  })
  .refine((e) => e.treatment !== 'VEHICLE_COST' || e.vehicleId, {
    message: 'Choose the vehicle this cost belongs to',
    path: ['vehicleId'],
  });
export type ExpenseInput = z.infer<typeof expenseSchema>;

export const recurringExpenseSchema = z.object({
  description: requiredText(200),
  vendorId: optionalId(),
  accountId: id(),
  amount: moneyInput,
  applyTax: z.boolean().default(true),
  method: paymentMethod,
  bankAccountId: id(),
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  nextDate: dateInput,
  endDate: dateInput.optional().nullable(),
});
export type RecurringExpenseInput = z.infer<typeof recurringExpenseSchema>;

// --- Banking ---------------------------------------------------------------------------------

export const bankAccountSchema = z.object({
  name: requiredText(80),
  bankName: optionalText(80),
  type: z.enum(BANK_ACCOUNT_TYPES),
  accountNumberLast4: z
    .string()
    .regex(/^\d{4}$/, 'Enter the last four digits only')
    .optional()
    .nullable()
    .or(z.literal(''))
    .transform((value) => (value ? value : null)),
  openingBalance: signedMoneyInput.default(0),
  openingDate: dateInput,
});
export type BankAccountInput = z.infer<typeof bankAccountSchema>;

export const bankAccountUpdateSchema = z
  .object({ name: requiredText(80), bankName: optionalText(80), isActive: z.boolean() })
  .partial();

export const bankTransactionSchema = z
  .object({
    bankAccountId: id(),
    kind: z.enum(BANK_TRANSACTION_KINDS),
    date: dateInput,
    /** For an adjustment, the sign says which way; otherwise positive. */
    amount: signedMoneyInput,
    counterAccountId: optionalId(),
    toBankAccountId: optionalId(),
    description: requiredText(200),
    reference: paymentReferenceInput,
  })
  .refine((t) => t.amount !== 0, { message: 'The amount must not be zero', path: ['amount'] })
  .refine((t) => t.kind === 'ADJUSTMENT' || t.amount > 0, {
    message: 'Enter a positive amount',
    path: ['amount'],
  })
  .refine((t) => t.kind !== 'TRANSFER' || (t.toBankAccountId && t.toBankAccountId !== t.bankAccountId), {
    message: 'Choose a different account to transfer to',
    path: ['toBankAccountId'],
  })
  .refine((t) => t.kind === 'TRANSFER' || t.kind === 'FEE' || t.counterAccountId, {
    message: 'Choose the account on the other side',
    path: ['counterAccountId'],
  });
export type BankTransactionInput = z.infer<typeof bankTransactionSchema>;

export const reconciliationStartSchema = z.object({
  bankAccountId: id(),
  statementDate: dateInput,
  endingBalance: signedMoneyInput,
  /** Defaults to the last completed reconciliation's ending balance. */
  beginningBalance: signedMoneyInput.optional(),
});
export type ReconciliationStartInput = z.infer<typeof reconciliationStartSchema>;

export const reconciliationLinesSchema = z.object({
  clearedLineIds: z.array(id()).max(5000),
});

export const reconciliationCompleteSchema = z.object({
  /** An authorized adjustment for a remaining difference, with the reason. */
  adjustment: z
    .object({ accountId: id(), reason: requiredText(300) })
    .optional()
    .nullable(),
});

// --- Floor plan ---------------------------------------------------------------------------------

export const floorPlanNoteSchema = z.object({
  lenderVendorId: id(),
  vehicleId: id(),
  principal: moneyInput,
  interestRate: rateInput,
  originationDate: dateInput,
  maturityDate: dateInput.optional().nullable(),
  /** Where the advanced cash landed. */
  bankAccountId: id(),
  reference: optionalText(60),
});
export type FloorPlanNoteInput = z.infer<typeof floorPlanNoteSchema>;

export const floorPlanPaymentSchema = z
  .object({
    kind: z.enum(['PRINCIPAL_PAYMENT', 'INTEREST_PAYMENT', 'PAYOFF']),
    date: dateInput,
    principal: optionalMoneyInput,
    interest: optionalMoneyInput,
    bankAccountId: id(),
  })
  .refine((p) => p.kind === 'PAYOFF' || p.principal + p.interest > 0, {
    message: 'Enter the principal or interest paid',
    path: ['principal'],
  });
export type FloorPlanPaymentInput = z.infer<typeof floorPlanPaymentSchema>;

// --- Reporting -----------------------------------------------------------------------------------

const optionalQueryId = z
  .string()
  .uuid()
  .optional()
  .or(z.literal('').transform(() => undefined));

export const reportQuerySchema = z.object({
  preset: z.enum(DATE_RANGE_PRESETS).optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
  /** Compare with the previous period or the same period a year earlier. */
  compare: z.enum(['NONE', 'PREVIOUS_PERIOD', 'PREVIOUS_YEAR']).default('NONE'),
  accountId: optionalQueryId,
  vehicleId: optionalQueryId,
  customerId: optionalQueryId,
  vendorId: optionalQueryId,
  userId: optionalQueryId,
  salespersonId: optionalQueryId,
  source: z.enum(JOURNAL_SOURCES).optional(),
  vin: z.string().trim().toUpperCase().max(17).optional(),
  reference: z.string().trim().max(60).optional(),
  make: z.string().trim().max(60).optional(),
  model: z.string().trim().max(60).optional(),
  province: province.optional(),
  status: z.string().trim().max(30).optional(),
  profitability: z.enum(['ALL', 'PROFITABLE', 'LOSS']).default('ALL'),
  minAgeDays: z.coerce.number().int().min(0).max(10_000).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const exportQuerySchema = reportQuerySchema.extend({
  format: z.enum(['csv', 'xlsx', 'pdf']).default('csv'),
  /** The reconciliation report is one statement's. */
  reconciliationId: optionalQueryId,
  /** The monthly report's month, YYYY-MM. */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});
export type ExportQuery = z.infer<typeof exportQuerySchema>;

export const exportReportParamSchema = z.enum(EXPORTABLE_REPORTS);

export const savedReportFilterSchema = z.object({
  name: requiredText(80),
  report: requiredText(40),
  filters: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type SavedReportFilterInput = z.infer<typeof savedReportFilterSchema>;

export const accountingSearchSchema = z.object({ q: z.string().trim().min(2).max(100) });
