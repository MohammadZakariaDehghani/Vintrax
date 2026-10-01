'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Mail, MessageSquare, Phone, Trash2 } from 'lucide-react';
import {
  CREDIT_RANGE_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  FINANCE_APPLICATION_STATUSES,
  FINANCE_APPLICATION_STATUS_LABELS,
  HOUSING_STATUS_LABELS,
  INCOME_FREQUENCY_LABELS,
  PREFERRED_CONTACT_LABELS,
  ageOn,
  type FinanceApplicationDetail,
  type FinanceApplicationStatus,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatDate, formatKm, formatPrice } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorAlert,
  Field,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { DashboardNav } from '@/components/dashboard-nav';
import { DealerNav } from '@/components/dealer-nav';
import { FINANCE_STATUS_VARIANT } from '../status';

function duration(months: number | null): string | null {
  if (months === null) return null;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years ? `${years} yr` : '', rest ? `${rest} mo` : ''].filter(Boolean).join(' ') || '0 mo';
}

function Facts({ rows }: { rows: Array<[string, string | null | undefined]> }) {
  return (
    <dl className="divide-y divide-border text-sm">
      {rows
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ['finance-application', id],
    queryFn: () => api.get<FinanceApplicationDetail>(`/dealer/finance-applications/${id}`),
  });

  const [status, setStatus] = useState<FinanceApplicationStatus>('NEW');
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!data) return;
    setStatus(data.status);
    setNotes(data.dealerNotes ?? '');
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api.patch<FinanceApplicationDetail>(`/dealer/finance-applications/${id}`, {
        status,
        dealerNotes: notes.trim() || null,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['finance-application', id], next);
      void queryClient.invalidateQueries({ queryKey: ['finance-applications'] });
      setSaved(true);
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/dealer/finance-applications/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finance-applications'] });
      router.push('/dealer/finance');
    },
  });

  if (isPending) return <Spinner label="Loading application" />;
  if (!data) {
    return (
      <div className="container py-8">
        <ErrorAlert error={error} />
      </div>
    );
  }

  const name = `${data.firstName} ${data.lastName}`;
  const phoneDigits = data.phone.replace(/[^\d+]/g, '');

  return (
    <div className="container py-8">
      <DashboardNav />
      <DealerNav />

      <Link
        href="/dealer/finance"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        All finance applications
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{name}</h1>
          <p className="mt-1 text-muted-foreground">
            Applied {formatDate(data.createdAt)} for the{' '}
            <Link href={`/vehicles/${data.vehicle.slug}`} className="text-primary hover:underline">
              {data.vehicle.title}
            </Link>{' '}
            · {formatPrice(data.vehicle.priceCad)}
          </p>
        </div>
        <Badge variant={FINANCE_STATUS_VARIANT[data.status]} className="text-sm">
          {FINANCE_APPLICATION_STATUS_LABELS[data.status]}
        </Badge>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <a href={`tel:${phoneDigits}`}>
          <Button variant="outline">
            <Phone className="h-4 w-4" aria-hidden />
            {data.phone}
          </Button>
        </a>
        <a href={`sms:${phoneDigits}`}>
          <Button variant="outline">
            <MessageSquare className="h-4 w-4" aria-hidden />
            Text
          </Button>
        </a>
        <a
          href={`mailto:${data.email}?subject=${encodeURIComponent(`Financing for the ${data.vehicle.title}`)}`}
        >
          <Button variant="outline">
            <Mail className="h-4 w-4" aria-hidden />
            {data.email}
          </Button>
        </a>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Applicant</CardTitle>
            </CardHeader>
            <CardContent>
              <Facts
                rows={[
                  ['Date of birth', `${data.dateOfBirth} (age ${ageOn(data.dateOfBirth)})`],
                  ['Postal code', data.postalCode],
                  ['Prefers', PREFERRED_CONTACT_LABELS[data.preferredContact]],
                  [
                    'Would like to visit',
                    data.preferredVisitDate ? formatDate(data.preferredVisitDate) : null,
                  ],
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Finances</CardTitle>
            </CardHeader>
            <CardContent>
              <Facts
                rows={[
                  [
                    'Credit range',
                    `${CREDIT_RANGE_LABELS[data.creditRange].label} (${CREDIT_RANGE_LABELS[data.creditRange].range})`,
                  ],
                  [
                    'Gross income',
                    `${formatPrice(data.grossIncomeCad)} ${INCOME_FREQUENCY_LABELS[data.incomeFrequency].toLowerCase()}`,
                  ],
                  ['Per year', formatPrice(data.annualIncomeCad)],
                  ['Down payment', formatPrice(data.downPaymentCad)],
                  ['Term', `${data.termMonths} months`],
                  [
                    'To finance',
                    formatPrice(Math.max(0, data.vehicle.priceCad - data.downPaymentCad)),
                  ],
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Work and home</CardTitle>
            </CardHeader>
            <CardContent>
              <Facts
                rows={[
                  ['Employment', EMPLOYMENT_STATUS_LABELS[data.employmentStatus]],
                  ['Employer', data.employerName],
                  ['Job title', data.jobTitle],
                  ['Time there', duration(data.employmentMonths)],
                  ['Housing', HOUSING_STATUS_LABELS[data.housingStatus]],
                  [
                    'Rent or mortgage',
                    data.monthlyHousingCad !== null
                      ? `${formatPrice(data.monthlyHousingCad)} / month`
                      : null,
                  ],
                  ['At this address', duration(data.addressMonths)],
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trade-in</CardTitle>
            </CardHeader>
            <CardContent>
              {data.hasTradeIn ? (
                <Facts
                  rows={[
                    [
                      'Vehicle',
                      `${data.tradeInYear ?? ''} ${data.tradeInMake ?? ''} ${data.tradeInModel ?? ''}`.trim(),
                    ],
                    [
                      'Mileage',
                      data.tradeInMileageKm !== null ? formatKm(data.tradeInMileageKm) : null,
                    ],
                    [
                      'Still owed',
                      data.tradeInOwedCad !== null ? formatPrice(data.tradeInOwedCad) : 'Paid off',
                    ],
                  ]}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No trade-in.</p>
              )}
            </CardContent>
          </Card>

          {data.comments ? (
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>From the buyer</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-line text-sm">{data.comments}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Your follow-up</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSaved(false);
                  save.mutate();
                }}
              >
                <Field label="Status" htmlFor="finance-status">
                  <Select
                    id="finance-status"
                    value={status}
                    onChange={(event) => {
                      setStatus(event.target.value as FinanceApplicationStatus);
                      setSaved(false);
                    }}
                  >
                    {FINANCE_APPLICATION_STATUSES.map((entry) => (
                      <option key={entry} value={entry}>
                        {FINANCE_APPLICATION_STATUS_LABELS[entry]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Notes"
                  htmlFor="finance-notes"
                  hint="Private to your dealership. The buyer never sees them."
                >
                  <Textarea
                    id="finance-notes"
                    rows={6}
                    maxLength={4000}
                    value={notes}
                    onChange={(event) => {
                      setNotes(event.target.value);
                      setSaved(false);
                    }}
                  />
                </Field>
                <ErrorAlert error={save.error} />
                <div className="flex items-center justify-end gap-3">
                  {saved ? <span className="text-sm text-success">Saved</span> : null}
                  <Button type="submit" loading={save.isPending}>
                    Save
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5 text-sm">
              <p className="text-muted-foreground">
                Deleting removes the application and the buyer’s personal details from Vintrax for
                good.
              </p>
              <ErrorAlert error={remove.error} className="mt-3" />
              <Button
                type="button"
                variant="outline"
                className="mt-3 w-full text-destructive hover:text-destructive"
                loading={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete ${name}'s application? This cannot be undone.`)) {
                    remove.mutate();
                  }
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete application
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function FinanceApplicationPage() {
  return (
    <RequireAuth sellersOnly dealersOnly>
      <ApplicationDetail />
    </RequireAuth>
  );
}
