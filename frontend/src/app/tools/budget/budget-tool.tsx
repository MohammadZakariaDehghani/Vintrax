'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Info } from 'lucide-react';
import {
  CREDIT_BANDS,
  CREDIT_BAND_INFO,
  LOAN_TERMS,
  PROVINCES,
  PROVINCE_LABELS,
  VEHICLE_SALES_TAX_RATES,
  estimateBudget,
  type CreditBand,
  type Province,
  type VehicleSearchResponse,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn, formatPrice } from '@/lib/utils';
import { Button, Card, CardContent, Field, Input, Select } from '@/components/ui';

const MONTHLY = { min: 100, max: 2_500, step: 25 } as const;

/** A money field: whole dollars, never negative, blank read as zero. */
function MoneyInput({
  id,
  value,
  onChange,
  max = 1_000_000,
}: {
  id: string;
  value: number;
  onChange: (next: number) => void;
  max?: number;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        $
      </span>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        step={100}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const next = Number(e.target.value);
          onChange(Number.isFinite(next) ? Math.min(max, Math.max(0, Math.round(next))) : 0);
        }}
        className="pl-7"
      />
    </div>
  );
}

function Line({
  label,
  value,
  sign,
  strong = false,
}: {
  label: string;
  value: number;
  sign?: '+' | '−';
  strong?: boolean;
}) {
  return (
    <div className={cn('flex justify-between gap-4 py-2 text-sm', strong && 'font-semibold')}>
      <dt className={strong ? undefined : 'text-muted-foreground'}>{label}</dt>
      <dd className="tabular">
        {sign ? `${sign} ` : ''}
        {formatPrice(Math.abs(value))}
      </dd>
    </div>
  );
}

/**
 * "Estimate your budget", after CarGurus' calculator of that name: from a
 * monthly payment, down payment, trade-in, credit band, loan length and
 * province, the most the car itself can cost — and a search for cars under it.
 *
 * Everything is worked out in the browser as the visitor types. The only
 * thing sent anywhere is the resulting price cap, as an ordinary search, to
 * count the cars under it.
 */
export function BudgetTool() {
  const [monthlyPayment, setMonthlyPayment] = useState(500);
  const [downPayment, setDownPayment] = useState(3_000);
  const [tradeInValue, setTradeInValue] = useState(0);
  const [amountOwed, setAmountOwed] = useState(0);
  const [credit, setCredit] = useState<CreditBand>('GOOD');
  const [rate, setRate] = useState<number>(CREDIT_BAND_INFO.GOOD.rate);
  const [termMonths, setTermMonths] = useState<number>(72);
  const [province, setProvince] = useState<Province>('ON');
  const [fees, setFees] = useState(800);

  const salesTaxRate = VEHICLE_SALES_TAX_RATES[province];
  const result = useMemo(
    () =>
      estimateBudget({
        monthlyPayment,
        downPayment,
        tradeInValue,
        amountOwed,
        annualRatePct: rate,
        termMonths,
        salesTaxRate,
        fees,
      }),
    [monthlyPayment, downPayment, tradeInValue, amountOwed, rate, termMonths, salesTaxRate, fees],
  );

  // The province only sets the sales tax. Cars listed anywhere in Canada are
  // in the budget, so the search is not limited to it.
  const shopHref = `/vehicles?${new URLSearchParams({
    maxPrice: String(result.maxVehiclePrice),
    sort: 'PRICE_DESC',
  }).toString()}`;

  // Counted once the figure stops moving, not on every step of the slider.
  const [countedPrice, setCountedPrice] = useState(result.maxVehiclePrice);
  useEffect(() => {
    const timer = setTimeout(() => setCountedPrice(result.maxVehiclePrice), 400);
    return () => clearTimeout(timer);
  }, [result.maxVehiclePrice]);
  const inBudget = useQuery({
    queryKey: ['budget-count', countedPrice],
    queryFn: () => api.get<VehicleSearchResponse>(`/vehicles?maxPrice=${countedPrice}&pageSize=1`),
    enabled: countedPrice > 0,
    staleTime: 60_000,
  });
  const carCount = countedPrice === result.maxVehiclePrice ? inBudget.data?.total : undefined;

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
      <Card>
        <CardContent className="grid gap-5 p-6 sm:grid-cols-2">
          <Field
            label={`Monthly payment: ${formatPrice(monthlyPayment)}`}
            htmlFor="budget-monthly"
            className="sm:col-span-2"
          >
            <div className="flex items-center gap-3">
              <input
                id="budget-monthly"
                type="range"
                min={MONTHLY.min}
                max={MONTHLY.max}
                step={MONTHLY.step}
                value={Math.min(MONTHLY.max, Math.max(MONTHLY.min, monthlyPayment))}
                onChange={(e) => setMonthlyPayment(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <div className="w-32">
                <MoneyInput
                  id="budget-monthly-amount"
                  value={monthlyPayment}
                  onChange={setMonthlyPayment}
                  max={20_000}
                />
              </div>
            </div>
          </Field>

          <Field label="Down payment" htmlFor="budget-down">
            <MoneyInput id="budget-down" value={downPayment} onChange={setDownPayment} />
          </Field>

          <Field label="Loan length" htmlFor="budget-term">
            <Select
              id="budget-term"
              value={termMonths}
              onChange={(e) => setTermMonths(Number(e.target.value))}
            >
              {LOAN_TERMS.map((months) => (
                <option key={months} value={months}>
                  {months} months ({months / 12} years)
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Trade-in value"
            htmlFor="budget-trade"
            hint="What your current car is worth, if you’re trading it in."
          >
            <MoneyInput id="budget-trade" value={tradeInValue} onChange={setTradeInValue} />
          </Field>

          <Field
            label="Still owed on the trade-in"
            htmlFor="budget-owed"
            hint="Paid off from the trade-in’s value."
          >
            <MoneyInput id="budget-owed" value={amountOwed} onChange={setAmountOwed} />
          </Field>

          <Field label="Credit" htmlFor="budget-credit">
            <Select
              id="budget-credit"
              value={credit}
              onChange={(e) => {
                const band = e.target.value as CreditBand;
                setCredit(band);
                setRate(CREDIT_BAND_INFO[band].rate);
              }}
            >
              {CREDIT_BANDS.map((band) => (
                <option key={band} value={band}>
                  {CREDIT_BAND_INFO[band].label} ({CREDIT_BAND_INFO[band].scores})
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Interest rate (APR %)"
            htmlFor="budget-rate"
            hint="A typical rate for that credit. Change it if you have a quote."
          >
            <Input
              id="budget-rate"
              type="number"
              inputMode="decimal"
              min={0}
              max={40}
              step={0.01}
              value={rate}
              onChange={(e) => {
                const next = Number(e.target.value);
                setRate(Number.isFinite(next) ? Math.min(40, Math.max(0, next)) : 0);
              }}
            />
          </Field>

          <Field
            label="Province"
            htmlFor="budget-province"
            hint={`Sales tax about ${Number((salesTaxRate * 100).toFixed(3))} %.`}
          >
            <Select
              id="budget-province"
              value={province}
              onChange={(e) => setProvince(e.target.value as Province)}
            >
              {PROVINCES.map((code) => (
                <option key={code} value={code}>
                  {PROVINCE_LABELS[code]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Dealer and licensing fees"
            htmlFor="budget-fees"
            hint="Documentation, licensing and registration. Taxed with the car."
          >
            <MoneyInput id="budget-fees" value={fees} onChange={setFees} max={20_000} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
        <Card>
          <CardContent className="p-6" aria-live="polite">
            <p className="text-sm text-muted-foreground">Your car budget</p>
            <p className="tabular mt-1 text-4xl font-bold tracking-tight">
              {formatPrice(result.maxVehiclePrice)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The most the car itself can cost, before tax and fees.
            </p>

            <dl className="mt-5 divide-y divide-border border-y border-border">
              <Line label="Financed" value={result.loanAmount} />
              <Line label="Down payment" value={downPayment} sign="+" />
              <Line
                label="Trade-in equity"
                value={result.tradeInEquity}
                sign={result.tradeInEquity < 0 ? '−' : '+'}
              />
              <Line label="Total available" value={result.totalFinancing} strong />
              <Line label="Sales tax" value={result.salesTax} sign="−" />
              <Line label="Fees" value={fees} sign="−" />
              <Line label="Interest over the loan" value={result.totalInterest} />
            </dl>

            {result.maxVehiclePrice > 0 && carCount === 0 ? (
              <div className="mt-5">
                <p className="text-sm text-muted-foreground">
                  No cars under {formatPrice(result.maxVehiclePrice)} are listed right now. Try a
                  larger payment or down payment, or see the most affordable cars on Vintrax.
                </p>
                <Link href="/vehicles?sort=PRICE_ASC" className="mt-3 block">
                  <Button variant="outline" className="w-full">
                    See the most affordable cars
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Button>
                </Link>
              </div>
            ) : result.maxVehiclePrice > 0 ? (
              <Link href={shopHref} className="mt-5 block">
                <Button className="w-full">
                  {carCount === undefined
                    ? `Shop cars under ${formatPrice(result.maxVehiclePrice)}`
                    : `Shop ${carCount.toLocaleString('en-CA')} ${carCount === 1 ? 'car' : 'cars'} under ${formatPrice(result.maxVehiclePrice)}`}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </Link>
            ) : (
              <p className="mt-5 text-sm text-destructive">
                What’s owed on the trade-in is more than the payment and down payment cover. Try a
                larger payment or down payment.
              </p>
            )}
            <Link
              href="/tools/car-value"
              className="mt-3 block text-center text-sm font-medium text-primary hover:underline"
            >
              Not sure what your trade-in is worth?
            </Link>
          </CardContent>
        </Card>

        <p className="flex gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            An estimate, not a loan offer. Rates depend on your lender and credit, and tax varies
            with the car and how you buy it; most provinces take the trade-in off the taxable price,
            as this does.
          </span>
        </p>
      </div>
    </div>
  );
}
