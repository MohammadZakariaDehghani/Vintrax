'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PROVINCES,
  PROVINCE_LABELS,
  formatRate,
} from '@vintrax/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { useAccounting } from '@/components/accounting/context';
import {
  BankSelect,
  CustomerSelect,
  VehicleSelect,
  VendorSelect,
} from '@/components/accounting/pickers';
import {
  Amount,
  MoneyInput,
  PageHeader,
  fieldError,
  useAcctMutation,
  useAcctQuery,
} from '@/components/accounting/ui';
import { acct, centsInput, money, percent, qs, todayIso } from '@/lib/accounting';
import { useUser } from '@/store/auth-store';

interface SaleForm {
  vehicleId: string;
  customerId: string;
  salespersonId: string;
  saleDate: string;
  salePrice: string;
  discount: string;
  documentationFee: string;
  dealerFees: string;
  accessories: string;
  warranty: string;
  otherCharges: string;
  financeRevenue: string;
  financeLenderVendorId: string;
  tradeInId: string;
  deposits: Array<{ depositId: string; amount: string }>;
  downPayment: string;
  downPaymentMethod: string;
  bankAccountId: string;
  financedAmount: string;
  taxProvince: string;
  dueDate: string;
  notes: string;
}

const EMPTY: SaleForm = {
  vehicleId: '',
  customerId: '',
  salespersonId: '',
  saleDate: todayIso(),
  salePrice: '',
  discount: '',
  documentationFee: '',
  dealerFees: '',
  accessories: '',
  warranty: '',
  otherCharges: '',
  financeRevenue: '',
  financeLenderVendorId: '',
  tradeInId: '',
  deposits: [],
  downPayment: '',
  downPaymentMethod: '',
  bankAccountId: '',
  financedAmount: '',
  taxProvince: '',
  dueDate: '',
  notes: '',
};

interface Quote {
  province: string;
  vehicleNetCents: number;
  feesCents: number;
  subtotalCents: number;
  tax: {
    components: Array<{
      ruleId: string;
      taxType: string;
      rate: string;
      taxableCents: number;
      exemptCents: number;
      tradeInDeductedCents: number;
      taxCents: number;
    }>;
    totalTaxCents: number;
  };
  taxTotalCents: number;
  totalCents: number;
  tradeAllowanceCents: number;
  lienPayoffCents: number;
  depositsCents: number;
  downPaymentCents: number;
  financedCents: number;
  balanceDueCents: number;
  costOfSaleCents?: number;
  grossProfitCents?: number;
  grossMarginBasisPoints?: number | null;
  warnings: string[];
}

interface DepositRow {
  id: string;
  number: number;
  date: string;
  remainingCents: number;
  status: string;
  vehicle: { id: string } | null;
}

interface TradeInRow {
  id: string;
  year: number;
  make: string;
  model: string;
  tradeAllowanceCents: number;
  lienPayoffCents: number;
  status: string;
  sale: { id: string } | null;
}

function toBody(form: SaleForm) {
  const blank = (value: string) => value || null;
  return {
    ...form,
    salespersonId: blank(form.salespersonId),
    financeLenderVendorId: blank(form.financeLenderVendorId),
    tradeInId: blank(form.tradeInId),
    downPaymentMethod: blank(form.downPaymentMethod),
    bankAccountId: blank(form.bankAccountId),
    taxProvince: blank(form.taxProvince),
    dueDate: blank(form.dueDate),
    notes: blank(form.notes),
    deposits: form.deposits.filter((deposit) => deposit.amount),
  };
}

function DealDesk() {
  const params = useSearchParams();
  const router = useRouter();
  const user = useUser();
  const { can, status } = useAccounting();
  const draftId = params?.get('draft') ?? null;
  const [form, setForm] = useState<SaleForm>(() => ({
    ...EMPTY,
    vehicleId: params?.get('vehicleId') ?? '',
    salespersonId:
      status.role === 'SALES_USER' || status.role === 'SALES_MANAGER' ? (user?.id ?? '') : '',
  }));
  const [loadedDraft, setLoadedDraft] = useState(!draftId);
  const set = <K extends keyof SaleForm>(key: K, value: SaleForm[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  // Reopen a saved draft: it is stored as the form was typed.
  const draft = useAcctQuery<{ draft: Partial<SaleForm> | null; status: string }>(
    ['sale', draftId],
    `/sales/${draftId}`,
    Boolean(draftId),
  );
  useEffect(() => {
    if (!draft.data || loadedDraft) return;
    const saved = draft.data.draft ?? {};
    const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
    setForm({
      ...EMPTY,
      ...Object.fromEntries(
        Object.entries(saved).map(([key, value]) => [
          key,
          key === 'deposits' ? value : text(value),
        ]),
      ),
      deposits: (saved.deposits as SaleForm['deposits'] | undefined) ?? [],
    } as SaleForm);
    setLoadedDraft(true);
  }, [draft.data, loadedDraft]);

  const deposits = useAcctQuery<DepositRow[]>(
    ['deposits', form.customerId],
    `/deposits${qs({ customerId: form.customerId })}`,
    Boolean(form.customerId),
  );
  const tradeIns = useAcctQuery<TradeInRow[]>(
    ['trade-ins', form.customerId],
    `/trade-ins${qs({ customerId: form.customerId })}`,
    Boolean(form.customerId),
  );
  const openDeposits = (deposits.data ?? []).filter((deposit) => deposit.remainingCents > 0);
  const availableTrades = (tradeIns.data ?? []).filter(
    (trade) => trade.status === 'DRAFT' && !trade.sale,
  );

  // A live recap of the deal as it is typed.
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<unknown>(null);
  const ready = Boolean(form.vehicleId && form.customerId && form.salePrice);
  const bodyKey = JSON.stringify(toBody(form));
  useEffect(() => {
    if (!ready) {
      setQuote(null);
      return;
    }
    const timer = setTimeout(() => {
      acct
        .post<Quote>('/sales/quote', JSON.parse(bodyKey))
        .then((result) => {
          setQuote(result);
          setQuoteError(null);
        })
        .catch((error) => {
          setQuote(null);
          setQuoteError(error);
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [bodyKey, ready]);

  const saveDraft = useAcctMutation(
    () =>
      draftId
        ? acct.patch<{ id: string }>(`/sales/drafts/${draftId}`, toBody(form))
        : acct.post<{ id: string }>('/sales/drafts', toBody(form)),
    (saved) => router.push(`/dealer/accounting/sales/${saved.id}`),
  );
  const post = useAcctMutation(
    async () => {
      if (draftId) {
        await acct.patch(`/sales/drafts/${draftId}`, toBody(form));
        return acct.post<{ id: string }>(`/sales/drafts/${draftId}/post`);
      }
      return acct.post<{ id: string }>('/sales', toBody(form));
    },
    (saved) => router.push(`/dealer/accounting/sales/${saved.id}`),
  );
  const error = post.error ?? saveDraft.error;

  if (draftId && !loadedDraft)
    return draft.error ? <ErrorAlert error={draft.error} /> : <Spinner />;
  if (draft.data && draft.data.status !== 'DRAFT') {
    return (
      <ErrorAlert error={new Error('This deal is already posted. Reverse it to change it.')} />
    );
  }

  const money2 = (key: keyof SaleForm, label: string, hint?: string) => (
    <Field label={label} htmlFor={`sale-${key}`} hint={hint} error={fieldError(error, key)}>
      <MoneyInput
        id={`sale-${key}`}
        value={form[key] as string}
        onChange={(value) => set(key, value as never)}
      />
    </Field>
  );

  return (
    <>
      <PageHeader
        title={draftId ? 'Edit draft deal' : 'New deal'}
        description="Taxes are worked out from your province's rules on the sale date. Nothing is recorded until you save or post."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vehicle and customer</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Vehicle" htmlFor="sale-vehicle" error={fieldError(error, 'vehicleId')}>
                <VehicleSelect
                  id="sale-vehicle"
                  value={form.vehicleId}
                  onChange={(id, vehicle) =>
                    setForm((previous) => ({
                      ...previous,
                      vehicleId: id,
                      salePrice:
                        previous.salePrice || (vehicle ? centsInput(vehicle.askingPriceCents) : ''),
                    }))
                  }
                />
              </Field>
              <Field
                label="Customer"
                htmlFor="sale-customer"
                error={fieldError(error, 'customerId')}
              >
                <CustomerSelect
                  id="sale-customer"
                  value={form.customerId}
                  onChange={(id) =>
                    setForm((previous) => ({
                      ...previous,
                      customerId: id,
                      deposits: [],
                      tradeInId: '',
                    }))
                  }
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Sale date" htmlFor="sale-date" error={fieldError(error, 'saleDate')}>
                  <Input
                    id="sale-date"
                    type="date"
                    value={form.saleDate}
                    onChange={(event) => set('saleDate', event.target.value)}
                  />
                </Field>
                <Field label="Delivered in" htmlFor="sale-province" hint="Tax follows delivery.">
                  <Select
                    id="sale-province"
                    value={form.taxProvince}
                    onChange={(event) => set('taxProvince', event.target.value)}
                  >
                    <option value="">Dealer&apos;s province</option>
                    {PROVINCES.map((province) => (
                      <option key={province} value={province}>
                        {PROVINCE_LABELS[province]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Balance due by" htmlFor="sale-due">
                  <Input
                    id="sale-due"
                    type="date"
                    value={form.dueDate}
                    onChange={(event) => set('dueDate', event.target.value)}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Price and add-ons</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              {money2('salePrice', 'Vehicle price')}
              {money2('discount', 'Discount')}
              {money2('documentationFee', 'Documentation fee')}
              {money2('dealerFees', 'Other dealer fees')}
              {money2('accessories', 'Accessories')}
              {money2('warranty', 'Warranty')}
              {money2('otherCharges', 'Other charges')}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trade-in and deposits</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {!form.customerId ? (
                <p className="text-sm text-muted-foreground">
                  Choose the customer to see their trade-ins and deposits.
                </p>
              ) : (
                <>
                  <Field
                    label="Trade-in"
                    htmlFor="sale-trade"
                    hint="The trade is bought into inventory at its actual cash value when the sale posts."
                  >
                    <Select
                      id="sale-trade"
                      value={form.tradeInId}
                      onChange={(event) => set('tradeInId', event.target.value)}
                    >
                      <option value="">No trade-in</option>
                      {availableTrades.map((trade) => (
                        <option key={trade.id} value={trade.id}>
                          {trade.year} {trade.make} {trade.model} · allowance{' '}
                          {money(trade.tradeAllowanceCents)}
                          {trade.lienPayoffCents ? ` · payoff ${money(trade.lienPayoffCents)}` : ''}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <p className="-mt-2 text-xs">
                    <Link
                      href="/dealer/accounting/deposits"
                      className="text-primary hover:underline"
                    >
                      Appraise a trade-in or take a deposit
                    </Link>
                  </p>
                  {openDeposits.length > 0 ? (
                    <div>
                      <p className="mb-1 text-sm font-medium">Apply deposits</p>
                      <ul className="space-y-1">
                        {openDeposits.map((deposit) => {
                          const applied = form.deposits.find(
                            (entry) => entry.depositId === deposit.id,
                          );
                          return (
                            <li
                              key={deposit.id}
                              className="flex flex-wrap items-center gap-2 text-sm"
                            >
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(applied)}
                                  onChange={(event) =>
                                    set(
                                      'deposits',
                                      event.target.checked
                                        ? [
                                            ...form.deposits,
                                            {
                                              depositId: deposit.id,
                                              amount: centsInput(deposit.remainingCents),
                                            },
                                          ]
                                        : form.deposits.filter(
                                            (entry) => entry.depositId !== deposit.id,
                                          ),
                                    )
                                  }
                                />
                                Deposit #{deposit.number} · {money(deposit.remainingCents)}{' '}
                                available
                              </label>
                              {applied ? (
                                <MoneyInput
                                  id={`dep-${deposit.id}`}
                                  aria-label={`Amount of deposit #${deposit.number} to apply`}
                                  value={applied.amount}
                                  onChange={(value) =>
                                    set(
                                      'deposits',
                                      form.deposits.map((entry) =>
                                        entry.depositId === deposit.id
                                          ? { ...entry, amount: value }
                                          : entry,
                                      ),
                                    )
                                  }
                                />
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No open deposits for this customer.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment and financing</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              {money2('downPayment', 'Down payment')}
              <Field label="Paid by" htmlFor="sale-method">
                <Select
                  id="sale-method"
                  value={form.downPaymentMethod}
                  onChange={(event) => set('downPaymentMethod', event.target.value)}
                >
                  <option value="">—</option>
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {PAYMENT_METHOD_LABELS[method]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Deposited to"
                htmlFor="sale-bank"
                error={fieldError(error, 'bankAccountId')}
              >
                <BankSelect
                  id="sale-bank"
                  value={form.bankAccountId}
                  onChange={(id) => set('bankAccountId', id)}
                />
              </Field>
              {money2('financedAmount', 'Amount financed', 'Owed by the lender, not the customer.')}
              {money2('financeRevenue', 'Finance reserve', 'Paid to you by the lender.')}
              {can('accounting.view') ? (
                <Field
                  label="Finance lender"
                  htmlFor="sale-lender"
                  error={fieldError(error, 'financeLenderVendorId')}
                >
                  <VendorSelect
                    id="sale-lender"
                    kind="LENDER"
                    value={form.financeLenderVendorId}
                    onChange={(id) => set('financeLenderVendorId', id)}
                    placeholder="No financing"
                  />
                </Field>
              ) : null}
              <Field label="Notes" htmlFor="sale-notes" className="sm:col-span-3">
                <Textarea
                  id="sale-notes"
                  className="min-h-[70px]"
                  value={form.notes}
                  onChange={(event) => set('notes', event.target.value)}
                />
              </Field>
            </CardContent>
          </Card>
        </div>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Deal recap</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!ready ? (
                <p className="text-muted-foreground">
                  Choose a vehicle and customer and enter the price.
                </p>
              ) : null}
              <ErrorAlert error={quoteError} />
              {quote ? (
                <>
                  <Row label="Vehicle (after discount)" cents={quote.vehicleNetCents} />
                  <Row label="Fees and add-ons" cents={quote.feesCents} />
                  <Row label="Subtotal" cents={quote.subtotalCents} strong />
                  {quote.tax.components.map((component) => (
                    <div
                      key={component.ruleId}
                      className="flex justify-between gap-2 text-muted-foreground"
                    >
                      <span>
                        {component.taxType} {formatRate(component.rate)} on{' '}
                        {money(component.taxableCents)}
                        {component.tradeInDeductedCents ? (
                          <span className="block text-xs">
                            trade-in credit {money(component.tradeInDeductedCents)}
                          </span>
                        ) : null}
                      </span>
                      <Amount cents={component.taxCents} />
                    </div>
                  ))}
                  <Row label={`Tax (${quote.province})`} cents={quote.taxTotalCents} />
                  <Row label="Total" cents={quote.totalCents} strong />
                  {quote.tradeAllowanceCents ? (
                    <Row label="Less trade-in allowance" cents={-quote.tradeAllowanceCents} />
                  ) : null}
                  {quote.lienPayoffCents ? (
                    <Row label="Plus lien payoff" cents={quote.lienPayoffCents} />
                  ) : null}
                  {quote.depositsCents ? (
                    <Row label="Less deposits" cents={-quote.depositsCents} />
                  ) : null}
                  {quote.downPaymentCents ? (
                    <Row label="Less down payment" cents={-quote.downPaymentCents} />
                  ) : null}
                  {quote.financedCents ? (
                    <Row label="Less financed" cents={-quote.financedCents} />
                  ) : null}
                  <Row label="Balance due from customer" cents={quote.balanceDueCents} strong />
                  {quote.grossProfitCents !== undefined ? (
                    <div className="rounded-md bg-secondary/60 p-2">
                      <Row label="Cost of sale (book value)" cents={quote.costOfSaleCents ?? 0} />
                      <Row
                        label={`Gross profit · ${percent(quote.grossMarginBasisPoints ?? null)}`}
                        cents={quote.grossProfitCents}
                        strong
                      />
                    </div>
                  ) : null}
                  {quote.warnings.map((warning) => (
                    <Badge key={warning} variant="warning" className="whitespace-normal">
                      {warning}
                    </Badge>
                  ))}
                </>
              ) : null}
              <ErrorAlert error={error} />
              <div className="flex flex-col gap-2 pt-2">
                <Button
                  variant="secondary"
                  loading={saveDraft.isPending}
                  disabled={!ready}
                  onClick={() => saveDraft.mutate(undefined)}
                >
                  Save draft
                </Button>
                {can('accounting.post_sales') ? (
                  <Button
                    loading={post.isPending}
                    disabled={!quote}
                    onClick={() => post.mutate(undefined)}
                  >
                    Post sale
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    A sales manager or accountant posts the deal.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-2 ${strong ? 'border-t border-border pt-1 font-semibold' : ''}`}
    >
      <span>{label}</span>
      <Amount cents={cents} strong={strong} />
    </div>
  );
}

export default function NewDealPage() {
  return (
    <Suspense>
      <DealDesk />
    </Suspense>
  );
}
