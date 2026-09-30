'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Check, ChevronLeft, ShieldCheck } from 'lucide-react';
import {
  CREDIT_RANGES,
  CREDIT_RANGE_LABELS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS,
  FINANCE_TERMS_MONTHS,
  HOUSING_STATUSES,
  HOUSING_STATUS_LABELS,
  INCOME_FREQUENCIES,
  INCOME_FREQUENCY_LABELS,
  PREFERRED_CONTACTS,
  PREFERRED_CONTACT_LABELS,
  financeApplicationInputSchema,
  financeContactStepSchema,
  financeEmploymentStepSchema,
  financePlanStepSchema,
  financeTradeInStepSchema,
  type VehicleDetail,
} from '@vintrax/shared';
import type { ZodTypeAny } from 'zod';
import { api } from '@/lib/api-client';
import { cn, formatEnum, formatKm, formatPrice } from '@/lib/utils';
import { useUser } from '@/store/auth-store';
import { Button, Dialog, ErrorAlert, Field, Input, Select, Textarea } from '@/components/ui';

/** The form's values as typed: every field a string or flag until it is checked. */
interface FormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  postalCode: string;
  creditRange: string;
  grossIncomeCad: string;
  incomeFrequency: string;
  employmentStatus: string;
  employerName: string;
  jobTitle: string;
  employmentYears: string;
  employmentExtraMonths: string;
  housingStatus: string;
  monthlyHousingCad: string;
  addressYears: string;
  addressExtraMonths: string;
  hasTradeIn: boolean;
  tradeInYear: string;
  tradeInMake: string;
  tradeInModel: string;
  tradeInMileageKm: string;
  tradeInOwedCad: string;
  downPaymentCad: string;
  termMonths: string;
  preferredContact: string;
  preferredVisitDate: string;
  comments: string;
  consent: boolean;
}

type Errors = Partial<Record<string, string>>;

const STEPS = [
  'Contact and finance info',
  'Employment and housing',
  'Trade-in',
  'Payment and contact',
  'Review and send',
] as const;

/** "12,500", "$12 500" and "12500" all mean twelve thousand five hundred. */
function wholeNumber(value: string): number | null {
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number.parseInt(digits, 10) : null;
}

function months(years: string, extra: string): number | null {
  const y = wholeNumber(years);
  const m = wholeNumber(extra);
  if (y === null && m === null) return null;
  return (y ?? 0) * 12 + (m ?? 0);
}

/** The values each step's schema checks, converted from what was typed. */
function stepPayload(step: number, v: FormValues): Record<string, unknown> {
  switch (step) {
    case 0:
      return {
        firstName: v.firstName,
        lastName: v.lastName,
        email: v.email,
        phone: v.phone,
        dateOfBirth: v.dateOfBirth,
        postalCode: v.postalCode,
        creditRange: v.creditRange || undefined,
        grossIncomeCad: wholeNumber(v.grossIncomeCad) ?? 0,
        incomeFrequency: v.incomeFrequency,
      };
    case 1:
      return {
        employmentStatus: v.employmentStatus || undefined,
        employerName: v.employerName,
        jobTitle: v.jobTitle,
        employmentMonths: months(v.employmentYears, v.employmentExtraMonths),
        housingStatus: v.housingStatus || undefined,
        monthlyHousingCad: wholeNumber(v.monthlyHousingCad),
        addressMonths: months(v.addressYears, v.addressExtraMonths),
      };
    case 2:
      return {
        hasTradeIn: v.hasTradeIn,
        tradeInYear: wholeNumber(v.tradeInYear),
        tradeInMake: v.tradeInMake,
        tradeInModel: v.tradeInModel,
        tradeInMileageKm: wholeNumber(v.tradeInMileageKm),
        tradeInOwedCad: wholeNumber(v.tradeInOwedCad),
      };
    case 3:
      return {
        downPaymentCad: wholeNumber(v.downPaymentCad) ?? 0,
        termMonths: wholeNumber(v.termMonths) ?? 0,
        preferredContact: v.preferredContact,
        preferredVisitDate: v.preferredVisitDate || null,
        comments: v.comments,
      };
    default:
      return {};
  }
}

const STEP_SCHEMAS: ZodTypeAny[] = [
  financeContactStepSchema,
  financeEmploymentStepSchema,
  financeTradeInStepSchema,
  financePlanStepSchema,
];

/** Which step each field is on, so a server-side error can send the buyer back to it. */
const FIELD_STEP: Record<string, number> = {
  firstName: 0,
  lastName: 0,
  email: 0,
  phone: 0,
  dateOfBirth: 0,
  postalCode: 0,
  creditRange: 0,
  grossIncomeCad: 0,
  incomeFrequency: 0,
  employmentStatus: 1,
  employerName: 1,
  housingStatus: 1,
  tradeInYear: 2,
  tradeInMake: 2,
  tradeInModel: 2,
  tradeInMileageKm: 2,
  downPaymentCad: 3,
  termMonths: 3,
};

function errorsOf(schema: ZodTypeAny, payload: unknown): Errors {
  const result = schema.safeParse(payload);
  if (result.success) return {};
  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? 'form');
    errors[key] ??= issue.message;
  }
  return errors;
}

/**
 * The finance application, in five short steps, for one vehicle. It goes to
 * the vehicle's seller, who arranges financing with their own lenders:
 * Vintrax runs no credit check and promises no approval, and the copy says so.
 */
export function FinanceApplicationDialog({
  vehicle,
  open,
  onClose,
  initialComments = '',
}: {
  vehicle: VehicleDetail;
  open: boolean;
  onClose: () => void;
  /** What the buyer had typed to the seller, carried over as their comments. */
  initialComments?: string;
}) {
  const user = useUser();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [values, setValues] = useState<FormValues>(() => ({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    dateOfBirth: '',
    postalCode: '',
    creditRange: '',
    grossIncomeCad: '',
    incomeFrequency: 'ANNUALLY',
    employmentStatus: '',
    employerName: '',
    jobTitle: '',
    employmentYears: '',
    employmentExtraMonths: '',
    housingStatus: '',
    monthlyHousingCad: '',
    addressYears: '',
    addressExtraMonths: '',
    hasTradeIn: false,
    tradeInYear: '',
    tradeInMake: '',
    tradeInModel: '',
    tradeInMileageKm: '',
    tradeInOwedCad: '',
    downPaymentCad: '',
    termMonths: '72',
    preferredContact: 'PHONE',
    preferredVisitDate: '',
    comments: initialComments,
    consent: false,
  }));

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = useMutation({
    mutationFn: (body: unknown) =>
      api.post<{ id: string }>(`/vehicles/${vehicle.id}/finance-applications`, body),
    onSuccess: () => {
      onClose();
      router.push(`/vehicles/${vehicle.slug}/sent?kind=finance`);
    },
  });

  const payload = useMemo(
    () => ({
      ...stepPayload(0, values),
      ...stepPayload(1, values),
      ...stepPayload(2, values),
      ...stepPayload(3, values),
      consent: values.consent,
    }),
    [values],
  );

  function next() {
    const found = errorsOf(STEP_SCHEMAS[step]!, stepPayload(step, values));
    setErrors(found);
    if (Object.keys(found).length === 0) setStep((s) => s + 1);
  }

  function send() {
    const found = errorsOf(financeApplicationInputSchema, payload);
    const firstStep = Math.min(
      ...Object.keys(found).map((key) => (key === 'consent' ? 4 : (FIELD_STEP[key] ?? 4))),
    );
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setStep(Number.isFinite(firstStep) ? firstStep : 4);
      return;
    }
    submit.mutate(payload);
  }

  const text = (key: keyof FormValues, label: string, props: Record<string, unknown> = {}) => (
    <Field label={label} htmlFor={`fin-${key}`} error={errors[key]} hint={props['hint'] as string}>
      <Input
        id={`fin-${key}`}
        value={values[key] as string}
        onChange={(event) => set(key, event.target.value as never)}
        aria-invalid={errors[key] ? true : undefined}
        {...Object.fromEntries(Object.entries(props).filter(([k]) => k !== 'hint'))}
      />
    </Field>
  );

  const thumbnail = vehicle.images[0]?.url ?? vehicle.primaryImageUrl;

  return (
    <Dialog open={open} onClose={onClose} title={`${step + 1}. ${STEPS[step]}`} size="md">
      {/* Progress: one segment per step. */}
      <div className="-mx-5 -mt-4 mb-4 grid grid-cols-5 gap-0.5" aria-hidden>
        {STEPS.map((label, index) => (
          <span key={label} className={cn('h-1', index <= step ? 'bg-success' : 'bg-success/20')} />
        ))}
      </div>
      <p className="sr-only">
        Step {step + 1} of {STEPS.length}
      </p>

      <div className="mb-5 flex items-center justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0 text-sm">
          <p className="truncate">
            {vehicle.title} - <span className="tabular">{formatPrice(vehicle.priceCad)}</span>
          </p>
          <p className="truncate text-muted-foreground">
            {vehicle.seller.dealer?.name ?? vehicle.seller.displayName}
          </p>
        </div>
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt=""
            className="h-12 w-16 shrink-0 rounded-md border border-border object-cover"
          />
        ) : null}
      </div>

      {step === 0 ? (
        <section aria-labelledby="fin-step-title">
          <h3 id="fin-step-title" className="text-2xl font-bold tracking-tight">
            Start with your information
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Send {vehicle.seller.dealer?.name ?? 'the seller'} what they need to find you financing
            with their lenders. There is <strong>no credit check</strong> and no impact on your
            credit score.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {text('firstName', 'First name', { autoComplete: 'given-name' })}
            {text('lastName', 'Last name', { autoComplete: 'family-name' })}
            {text('email', 'Email', { type: 'email', autoComplete: 'email' })}
            {text('phone', 'Phone number', {
              type: 'tel',
              autoComplete: 'tel',
              hint: 'Example: 416 555 0134',
            })}
            {text('dateOfBirth', 'Date of birth', {
              type: 'date',
              autoComplete: 'bday',
              max: new Date().toISOString().slice(0, 10),
              hint: 'Format: YYYY-MM-DD',
            })}
            {text('postalCode', 'Postal code', {
              autoComplete: 'postal-code',
              placeholder: 'V5L 1A1',
            })}
          </div>

          <fieldset className="mt-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <legend className="text-sm font-medium">Estimated credit range</legend>
              <span className="text-xs text-muted-foreground">
                This will not impact your credit score.
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-2 overflow-hidden rounded-md border border-border sm:grid-cols-4">
              {CREDIT_RANGES.map((range) => {
                const selected = values.creditRange === range;
                return (
                  <button
                    key={range}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => set('creditRange', range)}
                    className={cn(
                      'border-border px-2 py-2.5 text-center text-sm transition-colors [&:not(:first-child)]:border-l',
                      selected
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : 'bg-secondary/40 text-muted-foreground hover:bg-secondary',
                    )}
                  >
                    <span className="block">{CREDIT_RANGE_LABELS[range].label}</span>
                    <span className="block text-xs">{CREDIT_RANGE_LABELS[range].range}</span>
                  </button>
                );
              })}
            </div>
            {errors['creditRange'] ? (
              <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">
                {errors['creditRange']}
              </p>
            ) : null}
          </fieldset>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {text('grossIncomeCad', 'Gross income', { inputMode: 'numeric', placeholder: '$0' })}
            <Field label="Income frequency" htmlFor="fin-incomeFrequency">
              <Select
                id="fin-incomeFrequency"
                value={values.incomeFrequency}
                onChange={(event) => set('incomeFrequency', event.target.value)}
              >
                {INCOME_FREQUENCIES.map((frequency) => (
                  <option key={frequency} value={frequency}>
                    {INCOME_FREQUENCY_LABELS[frequency]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="text-2xl font-bold tracking-tight sm:col-span-2">Work and home</h3>
          <Field
            label="Employment status"
            htmlFor="fin-employmentStatus"
            error={errors['employmentStatus']}
            className="sm:col-span-2"
          >
            <Select
              id="fin-employmentStatus"
              value={values.employmentStatus}
              onChange={(event) => set('employmentStatus', event.target.value)}
            >
              <option value="">Choose…</option>
              {EMPLOYMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {EMPLOYMENT_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </Field>
          {values.employmentStatus === 'EMPLOYED' || values.employmentStatus === 'SELF_EMPLOYED' ? (
            <>
              {text(
                'employerName',
                values.employmentStatus === 'SELF_EMPLOYED' ? 'Business name' : 'Employer',
                { autoComplete: 'organization' },
              )}
              {text('jobTitle', 'Job title', { autoComplete: 'organization-title' })}
              <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                {text('employmentYears', 'Years there', { inputMode: 'numeric' })}
                {text('employmentExtraMonths', 'and months', { inputMode: 'numeric' })}
              </div>
            </>
          ) : null}
          <Field label="Housing" htmlFor="fin-housingStatus" error={errors['housingStatus']}>
            <Select
              id="fin-housingStatus"
              value={values.housingStatus}
              onChange={(event) => set('housingStatus', event.target.value)}
            >
              <option value="">Choose…</option>
              {HOUSING_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {HOUSING_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </Field>
          {text('monthlyHousingCad', 'Monthly rent or mortgage', {
            inputMode: 'numeric',
            placeholder: '$0',
          })}
          <div className="grid grid-cols-2 gap-3 sm:col-span-2">
            {text('addressYears', 'Years at this address', { inputMode: 'numeric' })}
            {text('addressExtraMonths', 'and months', { inputMode: 'numeric' })}
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section>
          <h3 className="text-2xl font-bold tracking-tight">Trading in a vehicle?</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            The dealer can put its value toward this one.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Trade-in">
            {[
              { value: true, label: 'Yes, I have a trade-in' },
              { value: false, label: 'No trade-in' },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={values.hasTradeIn === option.value}
                onClick={() => set('hasTradeIn', option.value)}
                className={cn(
                  'rounded-md border px-3 py-3 text-sm font-medium transition-colors',
                  values.hasTradeIn === option.value
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-secondary',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {values.hasTradeIn ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              {text('tradeInYear', 'Year', { inputMode: 'numeric', placeholder: '2016' })}
              {text('tradeInMake', 'Make', { placeholder: 'Ford' })}
              {text('tradeInModel', 'Model', { placeholder: 'Focus' })}
              {text('tradeInMileageKm', 'Mileage (km)', { inputMode: 'numeric' })}
              {text('tradeInOwedCad', 'Still owed on it', {
                inputMode: 'numeric',
                placeholder: '$0',
                hint: 'Leave empty if it is paid off.',
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {step === 3 ? (
        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="text-2xl font-bold tracking-tight sm:col-span-2">How you’d like to pay</h3>
          {text('downPaymentCad', 'Down payment', { inputMode: 'numeric', placeholder: '$0' })}
          <Field label="Loan term" htmlFor="fin-termMonths" error={errors['termMonths']}>
            <Select
              id="fin-termMonths"
              value={values.termMonths}
              onChange={(event) => set('termMonths', event.target.value)}
            >
              {FINANCE_TERMS_MONTHS.map((term) => (
                <option key={term} value={term}>
                  {term} months
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Best way to reach you" htmlFor="fin-preferredContact">
            <Select
              id="fin-preferredContact"
              value={values.preferredContact}
              onChange={(event) => set('preferredContact', event.target.value)}
            >
              {PREFERRED_CONTACTS.map((contact) => (
                <option key={contact} value={contact}>
                  {PREFERRED_CONTACT_LABELS[contact]}
                </option>
              ))}
            </Select>
          </Field>
          {text('preferredVisitDate', 'Visit the dealer on (optional)', {
            type: 'date',
            min: new Date().toISOString().slice(0, 10),
          })}
          <Field
            label="Anything else the dealer should know? (optional)"
            htmlFor="fin-comments"
            className="sm:col-span-2"
          >
            <Textarea
              id="fin-comments"
              value={values.comments}
              maxLength={2000}
              onChange={(event) => set('comments', event.target.value)}
            />
          </Field>
        </section>
      ) : null}

      {step === 4 ? (
        <section>
          <h3 className="text-2xl font-bold tracking-tight">Check and send</h3>
          <dl className="mt-4 divide-y divide-border rounded-md border border-border text-sm">
            {[
              ['Name', `${values.firstName} ${values.lastName}`],
              ['Contact', `${values.email} · ${values.phone}`],
              [
                'Credit range',
                values.creditRange ? CREDIT_RANGE_LABELS[values.creditRange as 'GOOD'].label : '—',
              ],
              [
                'Income',
                `${formatPrice(wholeNumber(values.grossIncomeCad) ?? 0)} ${INCOME_FREQUENCY_LABELS[values.incomeFrequency as 'ANNUALLY'].toLowerCase()}`,
              ],
              ['Employment', values.employmentStatus ? formatEnum(values.employmentStatus) : '—'],
              [
                'Trade-in',
                values.hasTradeIn
                  ? `${values.tradeInYear} ${values.tradeInMake} ${values.tradeInModel}, ${formatKm(wholeNumber(values.tradeInMileageKm) ?? 0)}`
                  : 'None',
              ],
              [
                'Payment',
                `${formatPrice(wholeNumber(values.downPaymentCad) ?? 0)} down, ${values.termMonths} months`,
              ],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 px-3 py-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>

          <label className="mt-5 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={values.consent}
              onChange={(event) => set('consent', event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span>
              I agree to share these details with {vehicle.seller.dealer?.name ?? 'the seller'} so
              they can contact me and arrange financing for this vehicle. They may contact lenders
              on my behalf; nothing is sent to a lender without my say.
            </span>
          </label>
          {errors['consent'] ? (
            <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">
              {errors['consent']}
            </p>
          ) : null}

          <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            Only this seller can read your application. Vintrax is not a lender, runs no credit
            check, and does not decide approvals.
          </p>
          <ErrorAlert error={submit.error} className="mt-4" />
        </section>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
        {step > 0 ? (
          <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Back
          </Button>
        ) : (
          <span />
        )}
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={next}>
            Continue
          </Button>
        ) : (
          <Button type="button" onClick={send} loading={submit.isPending}>
            <Check className="h-4 w-4" aria-hidden />
            Send application
          </Button>
        )}
      </div>
    </Dialog>
  );
}
