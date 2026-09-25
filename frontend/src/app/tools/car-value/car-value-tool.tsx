'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Gauge, Info } from 'lucide-react';
import {
  PROVINCES,
  PROVINCE_LABELS,
  maxModelYear,
  type CarValueOption,
  type Province,
  type VehicleValueEstimate,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatKm, formatPrice } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
} from '@/components/ui';
import { VehicleRow } from '@/components/vehicle-row';

/** Model years offered: next year's back through this many. */
const YEARS_OFFERED = 30;

const CONFIDENCE: Record<
  NonNullable<VehicleValueEstimate['estimate']>['confidence'],
  { label: string; note: string }
> = {
  HIGH: { label: 'High confidence', note: 'Based on many close matches.' },
  MEDIUM: { label: 'Medium confidence', note: 'Based on a fair number of similar cars.' },
  LOW: {
    label: 'Low confidence',
    note: 'Based on only a few similar cars — treat it as a rough guide.',
  },
};

interface FormState {
  year: string;
  make: string;
  model: string;
  trim: string;
  mileageKm: string;
  province: Province | '';
}

function fromParams(params: URLSearchParams): FormState {
  const province = params.get('province') ?? '';
  return {
    year: params.get('year') ?? '',
    make: params.get('make') ?? '',
    model: params.get('model') ?? '',
    trim: params.get('trim') ?? '',
    mileageKm: params.get('mileageKm') ?? '',
    province: (PROVINCES as readonly string[]).includes(province) ? (province as Province) : '',
  };
}

function toQuery(form: FormState): string {
  const params = new URLSearchParams();
  params.set('year', form.year);
  params.set('make', form.make.trim());
  params.set('model', form.model.trim());
  params.set('mileageKm', String(Math.round(Number(form.mileageKm))));
  if (form.trim.trim()) params.set('trim', form.trim.trim());
  if (form.province) params.set('province', form.province);
  return params.toString();
}

function isComplete(form: FormState) {
  const km = Number(form.mileageKm);
  return Boolean(
    form.year && form.make.trim() && form.model.trim() && form.mileageKm !== '' && km >= 0,
  );
}

/** Where the market value sits between the low and high ends of the range. */
function RangeBar({ low, value, high }: { low: number; value: number; high: number }) {
  const position = high > low ? ((value - low) / (high - low)) * 100 : 50;
  return (
    <div className="mt-6">
      <div className="relative h-3 rounded-full bg-gradient-to-r from-primary/25 via-primary/60 to-primary/25">
        <span
          className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-card bg-primary shadow"
          style={{ left: `${Math.min(100, Math.max(0, position))}%` }}
          aria-hidden
        />
      </div>
      <div className="mt-2 flex justify-between text-sm text-muted-foreground">
        <span className="tabular">{formatPrice(low)}</span>
        <span className="tabular">{formatPrice(high)}</span>
      </div>
    </div>
  );
}

function Result({ data }: { data: VehicleValueEstimate }) {
  const { query, estimate } = data;
  const name = [query.year, query.make, query.model, query.trim].filter(Boolean).join(' ');
  const searchHref = `/vehicles?${new URLSearchParams({
    make: query.make,
    model: query.model,
    minYear: String(data.yearsCompared.from),
    maxYear: String(data.yearsCompared.to),
  }).toString()}`;

  if (!estimate) {
    return (
      <Card className="mt-8">
        <CardContent className="flex flex-col gap-3 p-6">
          <h2 className="text-xl font-bold">Not enough similar cars yet</h2>
          <p className="text-muted-foreground">
            We found {data.comparableCount === 0 ? 'no' : `only ${data.comparableCount}`}{' '}
            {query.make} {query.model} listed between {data.yearsCompared.from} and{' '}
            {data.yearsCompared.to}, which is too few to put a fair value on your {name}. Check the
            spelling of the make and model, or try again as more cars are listed.
          </p>
          <div>
            <Link href="/register?role=SELLER">
              <Button variant="outline">List it and let buyers make offers</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const confidence = CONFIDENCE[estimate.confidence];

  return (
    <div className="mt-8 flex flex-col gap-6">
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">
                Estimated market value · {name} · {formatKm(query.mileageKm)}
              </p>
              <p className="tabular mt-1 text-4xl font-bold tracking-tight md:text-5xl">
                {formatPrice(estimate.marketValue)}
              </p>
            </div>
            <Badge
              variant={
                estimate.confidence === 'HIGH'
                  ? 'success'
                  : estimate.confidence === 'LOW'
                    ? 'warning'
                    : 'default'
              }
              className="mt-1"
            >
              {confidence.label}
            </Badge>
          </div>

          <RangeBar low={estimate.low} value={estimate.marketValue} high={estimate.high} />

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm font-semibold">Selling it yourself</p>
              <p className="tabular mt-1 text-2xl font-bold">
                {formatPrice(estimate.low)} – {formatPrice(estimate.high)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                What similar cars are listed at. A private sale usually lands in this range.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm font-semibold">Trading it in at a dealer</p>
              <p className="tabular mt-1 text-2xl font-bold">
                {formatPrice(estimate.tradeInLow)} – {formatPrice(estimate.tradeInHigh)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Dealers offer less than they list at, to cover reconditioning and resale.
              </p>
            </div>
          </div>

          <p className="mt-5 flex gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {confidence.note} Compared with {data.comparableCount} {query.make} {query.model} from{' '}
              {data.yearsCompared.from}–{data.yearsCompared.to}
              {data.averageMileageKm !== null
                ? `, averaging ${formatKm(data.averageMileageKm)}`
                : ''}
              . Condition, accident history and options can move the real price either way; an
              estimate is not an offer.
            </span>
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/register?role=SELLER">
              <Button>
                Sell it on Vintrax <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </Link>
            <Link href="/tools/budget">
              <Button variant="outline">Estimate your budget for the next one</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {data.comparables.length > 0 ? (
        <section>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-bold tracking-tight">Similar cars for sale</h2>
            <Link href={searchHref} className="text-sm font-medium text-primary hover:underline">
              See them all <ArrowRight className="inline h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {data.comparables.map((vehicle) => (
              <VehicleRow key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/**
 * "Check your car's value instantly", after CarGurus' tool of that name:
 * year, make, model and kilometres in; an estimated market value, a private
 * sale range and a trade-in range out, from comparable cars on Vintrax.
 *
 * The answer's inputs live in the address bar, so a result can be bookmarked,
 * shared, or reached from a link that fills the form in.
 */
export function CarValueTool() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [form, setForm] = useState<FormState>(() => fromParams(new URLSearchParams(params)));
  const submitted = useMemo(() => {
    const current = fromParams(new URLSearchParams(params));
    return isComplete(current) ? toQuery(current) : null;
  }, [params]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const makes = useQuery({
    queryKey: ['car-value', 'makes'],
    queryFn: () => api.get<CarValueOption[]>('/car-value/makes'),
    staleTime: 10 * 60_000,
  });
  const models = useQuery({
    queryKey: ['car-value', 'models', form.make.toLowerCase()],
    queryFn: () =>
      api.get<CarValueOption[]>(`/car-value/models?make=${encodeURIComponent(form.make)}`),
    enabled: form.make.trim().length > 0,
    staleTime: 10 * 60_000,
  });
  const estimate = useQuery({
    queryKey: ['car-value', 'estimate', submitted],
    queryFn: () => api.get<VehicleValueEstimate>(`/car-value/estimate?${submitted}`),
    enabled: submitted !== null,
    staleTime: 60_000,
  });

  // Back and forward move through earlier answers; keep the form in step.
  useEffect(() => {
    setForm(fromParams(new URLSearchParams(params)));
  }, [params]);

  const years = useMemo(() => {
    const newest = maxModelYear();
    return Array.from({ length: YEARS_OFFERED }, (_, index) => String(newest - index));
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!isComplete(form)) return;
    router.replace(`${pathname}?${toQuery(form)}`, { scroll: false });
  }

  return (
    <>
      <Card className="mt-6">
        <CardContent className="p-6">
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" noValidate>
            <Field label="Year" htmlFor="value-year">
              <Select
                id="value-year"
                required
                value={form.year}
                onChange={(e) => set('year', e.target.value)}
              >
                <option value="">Select a year</option>
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Make" htmlFor="value-make" hint="e.g. Toyota">
              <Input
                id="value-make"
                required
                list="value-makes"
                autoComplete="off"
                maxLength={60}
                value={form.make}
                onChange={(e) =>
                  setForm((current) => ({ ...current, make: e.target.value, model: '' }))
                }
              />
              <datalist id="value-makes">
                {(makes.data ?? []).map((option) => (
                  <option key={option.value} value={option.value} />
                ))}
              </datalist>
            </Field>

            <Field label="Model" htmlFor="value-model" hint="e.g. RAV4">
              <Input
                id="value-model"
                required
                list="value-models"
                autoComplete="off"
                maxLength={60}
                value={form.model}
                onChange={(e) => set('model', e.target.value)}
              />
              <datalist id="value-models">
                {(models.data ?? []).map((option) => (
                  <option key={option.value} value={option.value} />
                ))}
              </datalist>
            </Field>

            <Field label="Trim" htmlFor="value-trim" hint="Optional, e.g. XLE">
              <Input
                id="value-trim"
                maxLength={80}
                value={form.trim}
                onChange={(e) => set('trim', e.target.value)}
              />
            </Field>

            <Field label="Kilometres" htmlFor="value-km" hint="From the odometer">
              <Input
                id="value-km"
                required
                type="number"
                inputMode="numeric"
                min={0}
                max={2_000_000}
                step={1000}
                value={form.mileageKm}
                onChange={(e) => set('mileageKm', e.target.value)}
              />
            </Field>

            <Field label="Province" htmlFor="value-province" hint="Optional">
              <Select
                id="value-province"
                value={form.province}
                onChange={(e) => set('province', e.target.value as Province | '')}
              >
                <option value="">Anywhere in Canada</option>
                {PROVINCES.map((province) => (
                  <option key={province} value={province}>
                    {PROVINCE_LABELS[province]}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="sm:col-span-2 lg:col-span-3">
              <Button
                type="submit"
                size="lg"
                disabled={!isComplete(form)}
                loading={estimate.isFetching}
                className="w-full sm:w-auto"
              >
                <Gauge className="h-4 w-4" aria-hidden />
                Get my car’s value
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div aria-live="polite">
        {submitted === null ? null : estimate.isPending ? (
          <Spinner label="Working out your car’s value" className="mt-8" />
        ) : estimate.error ? (
          <ErrorAlert error={estimate.error} className="mt-8" />
        ) : estimate.data ? (
          <Result data={estimate.data} />
        ) : null}
      </div>
    </>
  );
}
