import { z } from 'zod';
import { MIN_MODEL_YEAR, maxModelYear } from './domain';
import { MAX_PAGE_SIZE } from './schemas';

/**
 * Finance applications: a buyer sends a seller the details they need to
 * arrange financing for one vehicle, and the seller works through them in the
 * dealer portal.
 *
 * Vintrax is not a lender and runs no credit check. The application goes to
 * the seller, who arranges financing with their own lenders; nothing here
 * promises an approval or a rate.
 *
 * The personal details in an application (date of birth, income, employment)
 * are visible only to the applicant's chosen seller. No input names a seller
 * or an applicant: both come from the vehicle and the session.
 */

// --- Choices -----------------------------------------------------------------

export const CREDIT_RANGES = ['REBUILDING', 'FAIR', 'GOOD', 'EXCELLENT'] as const;
export type CreditRange = (typeof CREDIT_RANGES)[number];
export const CREDIT_RANGE_LABELS: Record<CreditRange, { label: string; range: string }> = {
  REBUILDING: { label: 'Rebuilding', range: '<640' },
  FAIR: { label: 'Fair', range: '641-699' },
  GOOD: { label: 'Good', range: '700-749' },
  EXCELLENT: { label: 'Excellent', range: '750-900' },
};

export const INCOME_FREQUENCIES = ['ANNUALLY', 'MONTHLY', 'BIWEEKLY', 'WEEKLY'] as const;
export type IncomeFrequency = (typeof INCOME_FREQUENCIES)[number];
export const INCOME_FREQUENCY_LABELS: Record<IncomeFrequency, string> = {
  ANNUALLY: 'Annually',
  MONTHLY: 'Monthly',
  BIWEEKLY: 'Every two weeks',
  WEEKLY: 'Weekly',
};
const PERIODS_PER_YEAR: Record<IncomeFrequency, number> = {
  ANNUALLY: 1,
  MONTHLY: 12,
  BIWEEKLY: 26,
  WEEKLY: 52,
};

/** Gross income per year, whatever frequency it was entered at. */
export function annualIncomeCad(amount: number, frequency: IncomeFrequency): number {
  return Math.round(amount * PERIODS_PER_YEAR[frequency]);
}

export const EMPLOYMENT_STATUSES = [
  'EMPLOYED',
  'SELF_EMPLOYED',
  'RETIRED',
  'STUDENT',
  'NOT_EMPLOYED',
  'OTHER',
] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];
export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  EMPLOYED: 'Employed',
  SELF_EMPLOYED: 'Self-employed',
  RETIRED: 'Retired',
  STUDENT: 'Student',
  NOT_EMPLOYED: 'Not employed',
  OTHER: 'Other',
};

export const HOUSING_STATUSES = ['OWN', 'RENT', 'WITH_FAMILY', 'OTHER'] as const;
export type HousingStatus = (typeof HOUSING_STATUSES)[number];
export const HOUSING_STATUS_LABELS: Record<HousingStatus, string> = {
  OWN: 'Own',
  RENT: 'Rent',
  WITH_FAMILY: 'Live with family',
  OTHER: 'Other',
};

export const FINANCE_TERMS_MONTHS = [24, 36, 48, 60, 72, 84, 96] as const;

export const PREFERRED_CONTACTS = ['PHONE', 'EMAIL', 'TEXT'] as const;
export type PreferredContact = (typeof PREFERRED_CONTACTS)[number];
export const PREFERRED_CONTACT_LABELS: Record<PreferredContact, string> = {
  PHONE: 'Phone call',
  EMAIL: 'Email',
  TEXT: 'Text message',
};

/** Where an application is in the seller's process. */
export const FINANCE_APPLICATION_STATUSES = [
  'NEW',
  'CONTACTED',
  'IN_REVIEW',
  'APPROVED',
  'DECLINED',
  'CLOSED',
] as const;
export type FinanceApplicationStatus = (typeof FINANCE_APPLICATION_STATUSES)[number];
export const FINANCE_APPLICATION_STATUS_LABELS: Record<FinanceApplicationStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  IN_REVIEW: 'In review',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
  CLOSED: 'Closed',
};
/** Statuses in which the applicant is still waiting on the seller. */
export const OPEN_FINANCE_STATUSES: readonly FinanceApplicationStatus[] = [
  'NEW',
  'CONTACTED',
  'IN_REVIEW',
];

// --- Field rules -------------------------------------------------------------

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

/** Whole dollars, as the form collects them. */
const dollars = (max: number, message = 'Enter an amount in dollars.') =>
  z.number({ invalid_type_error: message }).int(message).min(0, message).max(max);

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'That is not a real date.');

/** Age in whole years on `today`, from a `YYYY-MM-DD` date of birth. */
export function ageOn(dateOfBirth: string, today: Date = new Date()): number {
  const [year, month, day] = dateOfBirth.split('-').map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - year;
  const beforeBirthday =
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

export const CANADIAN_POSTAL_CODE = /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/;

// --- The application, step by step ---------------------------------------------

/** Step 1: contact and finance info. */
export const financeContactStepSchema = z.object({
  firstName: text(80).min(1, 'Enter your first name.'),
  lastName: text(80).min(1, 'Enter your last name.'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  phone: text(30).refine(
    (value) => value.replace(/\D/g, '').length >= 10,
    'Enter a phone number with area code, e.g. 416 555 0134.',
  ),
  dateOfBirth: calendarDate.refine((value) => {
    const age = ageOn(value);
    return age >= 18 && age <= 110;
  }, 'You must be at least 18 to apply for financing.'),
  postalCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(CANADIAN_POSTAL_CODE, 'Enter a Canadian postal code, e.g. V5L 1A1.'),
  creditRange: z.enum(CREDIT_RANGES, { errorMap: () => ({ message: 'Choose a credit range.' }) }),
  grossIncomeCad: dollars(100_000_000, 'Enter your gross income in dollars.').refine(
    (value) => value > 0,
    'Enter your gross income in dollars.',
  ),
  incomeFrequency: z.enum(INCOME_FREQUENCIES),
});

/** Step 2: employment and housing. */
export const financeEmploymentStepSchema = z
  .object({
    employmentStatus: z.enum(EMPLOYMENT_STATUSES, {
      errorMap: () => ({ message: 'Choose your employment status.' }),
    }),
    employerName: optionalText(120),
    jobTitle: optionalText(120),
    /** Months with the current employer. */
    employmentMonths: z
      .number()
      .int()
      .min(0)
      .max(720)
      .nullish()
      .transform((v) => v ?? null),
    housingStatus: z.enum(HOUSING_STATUSES, {
      errorMap: () => ({ message: 'Choose your housing situation.' }),
    }),
    monthlyHousingCad: dollars(1_000_000)
      .nullish()
      .transform((v) => v ?? null),
    /** Months at the current address. */
    addressMonths: z
      .number()
      .int()
      .min(0)
      .max(1200)
      .nullish()
      .transform((v) => v ?? null),
  })
  .superRefine((data, ctx) => {
    const employed =
      data.employmentStatus === 'EMPLOYED' || data.employmentStatus === 'SELF_EMPLOYED';
    if (employed && !data.employerName) {
      ctx.addIssue({
        code: 'custom',
        path: ['employerName'],
        message:
          data.employmentStatus === 'SELF_EMPLOYED'
            ? 'Enter your business name.'
            : 'Enter your employer.',
      });
    }
  });

/** Step 3: a vehicle to trade in, if there is one. */
export const financeTradeInStepSchema = z
  .object({
    hasTradeIn: z.boolean(),
    tradeInYear: z
      .number()
      .int()
      .min(MIN_MODEL_YEAR)
      .max(maxModelYear())
      .nullish()
      .transform((v) => v ?? null),
    tradeInMake: optionalText(60),
    tradeInModel: optionalText(60),
    tradeInMileageKm: z
      .number()
      .int()
      .min(0)
      .max(2_000_000)
      .nullish()
      .transform((v) => v ?? null),
    /** What is still owed on it, if anything. */
    tradeInOwedCad: dollars(10_000_000)
      .nullish()
      .transform((v) => v ?? null),
  })
  .superRefine((data, ctx) => {
    if (!data.hasTradeIn) return;
    if (!data.tradeInYear) {
      ctx.addIssue({ code: 'custom', path: ['tradeInYear'], message: 'Enter the year.' });
    }
    if (!data.tradeInMake) {
      ctx.addIssue({ code: 'custom', path: ['tradeInMake'], message: 'Enter the make.' });
    }
    if (!data.tradeInModel) {
      ctx.addIssue({ code: 'custom', path: ['tradeInModel'], message: 'Enter the model.' });
    }
    if (data.tradeInMileageKm === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['tradeInMileageKm'],
        message: 'Enter the mileage in kilometres.',
      });
    }
  });

/** Step 4: how the buyer wants to pay and be contacted. */
export const financePlanStepSchema = z.object({
  downPaymentCad: dollars(10_000_000),
  termMonths: z
    .number()
    .int()
    .refine((value) => (FINANCE_TERMS_MONTHS as readonly number[]).includes(value), {
      message: 'Choose a term.',
    }),
  preferredContact: z.enum(PREFERRED_CONTACTS),
  /** A day the buyer would like to visit, if they have one in mind. */
  preferredVisitDate: calendarDate.nullish().transform((v) => v ?? null),
  comments: optionalText(2000),
});

/**
 * The whole application as the buyer submits it. The consent must be given
 * explicitly: the seller receives personal and financial information.
 */
export const financeApplicationInputSchema = z
  .object({
    ...financeContactStepSchema.shape,
    ...financeEmploymentStepSchema.innerType().shape,
    ...financeTradeInStepSchema.innerType().shape,
    ...financePlanStepSchema.shape,
    consent: z.literal(true, {
      errorMap: () => ({
        message: 'Agree to share these details with the seller to send your application.',
      }),
    }),
  })
  .strict()
  .superRefine((data, ctx) => {
    for (const schema of [financeEmploymentStepSchema, financeTradeInStepSchema]) {
      const result = schema.safeParse(data);
      // Only the cross-field rules: field-level errors are already reported.
      if (!result.success) {
        for (const issue of result.error.issues) if (issue.code === 'custom') ctx.addIssue(issue);
      }
    }
  })
  .transform((data) =>
    data.hasTradeIn
      ? data
      : {
          ...data,
          tradeInYear: null,
          tradeInMake: null,
          tradeInModel: null,
          tradeInMileageKm: null,
          tradeInOwedCad: null,
        },
  );
export type FinanceApplicationInput = z.infer<typeof financeApplicationInputSchema>;

// --- What the seller sees ----------------------------------------------------

export interface FinanceApplicationVehicle {
  id: string;
  slug: string;
  title: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  priceCad: number;
  stockNumber: string | null;
  vin: string | null;
  primaryImageUrl: string | null;
}

export interface FinanceApplicationSummary {
  id: string;
  status: FinanceApplicationStatus;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  creditRange: CreditRange;
  annualIncomeCad: number;
  downPaymentCad: number;
  hasTradeIn: boolean;
  vehicle: FinanceApplicationVehicle;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceApplicationDetail extends FinanceApplicationSummary {
  dateOfBirth: string;
  postalCode: string;
  grossIncomeCad: number;
  incomeFrequency: IncomeFrequency;
  employmentStatus: EmploymentStatus;
  employerName: string | null;
  jobTitle: string | null;
  employmentMonths: number | null;
  housingStatus: HousingStatus;
  monthlyHousingCad: number | null;
  addressMonths: number | null;
  tradeInYear: number | null;
  tradeInMake: string | null;
  tradeInModel: string | null;
  tradeInMileageKm: number | null;
  tradeInOwedCad: number | null;
  termMonths: number;
  preferredContact: PreferredContact;
  preferredVisitDate: string | null;
  comments: string | null;
  /** The seller's own notes; never shown to the applicant. */
  dealerNotes: string | null;
}

export const financeApplicationQuerySchema = z.object({
  status: z.enum(FINANCE_APPLICATION_STATUSES).optional(),
  /** Name, email, phone, or the vehicle's title, stock number or VIN. */
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});
export type FinanceApplicationQuery = z.infer<typeof financeApplicationQuerySchema>;

export interface FinanceApplicationPage {
  items: FinanceApplicationSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Applications in each status, across the seller's whole list. */
  counts: Record<FinanceApplicationStatus, number>;
}

export const updateFinanceApplicationSchema = z
  .object({
    status: z.enum(FINANCE_APPLICATION_STATUSES).optional(),
    dealerNotes: optionalText(4000).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'Change at least one field.' });
export type UpdateFinanceApplicationInput = z.infer<typeof updateFinanceApplicationSchema>;

// --- The seller's settings ---------------------------------------------------

/**
 * Where a seller's new applications are announced, and whether their listings
 * take applications at all. A null email means the account's own address.
 */
export const financeSettingsSchema = z
  .object({
    acceptApplications: z.boolean(),
    notificationEmail: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .nullish()
      .transform((value) => (value ? value : null))
      .refine((value) => value === null || z.string().email().safeParse(value).success, {
        message: 'Enter a valid email address, or leave it empty to use your account email.',
      }),
  })
  .strict();
export type FinanceSettingsInput = z.infer<typeof financeSettingsSchema>;

export interface FinanceSettings {
  acceptApplications: boolean;
  /** The address set here, or null to use the account's. */
  notificationEmail: string | null;
  /** The address new applications actually go to. */
  effectiveEmail: string;
}

/** What a buyer needs to know before offering the finance form. */
export interface VehicleFinanceOptions {
  acceptsApplications: boolean;
  /** An application this buyer already sent for the vehicle that is still open. */
  openApplicationId: string | null;
}
