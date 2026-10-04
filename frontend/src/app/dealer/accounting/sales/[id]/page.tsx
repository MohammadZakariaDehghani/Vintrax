'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatRate } from '@vintrax/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorAlert,
  Spinner,
} from '@/components/ui';
import { Attachments } from '@/components/accounting/attachments';
import { useAccounting } from '@/components/accounting/context';
import {
  Amount,
  Facts,
  PageHeader,
  ReasonDialog,
  StatusBadge,
  useAcctMutation,
  useAcctQuery,
  vehicleLabel,
} from '@/components/accounting/ui';
import { acct, isoDate, money } from '@/lib/accounting';

interface SaleDetail {
  id: string;
  number: number;
  status: 'DRAFT' | 'POSTED' | 'VOID';
  saleDate: string;
  vehicle: {
    id: string;
    vin: string | null;
    year: number;
    make: string;
    model: string;
    stockNumber: string | null;
  };
  customer: { id: string; name: string; email: string | null; phone: string | null };
  salesperson: { firstName: string; lastName: string } | null;
  financeLender: { id: string; name: string } | null;
  taxProvince: string;
  salePriceCents: number;
  discountCents: number;
  documentationFeeCents: number;
  dealerFeesCents: number;
  accessoriesCents: number;
  warrantyCents: number;
  otherChargesCents: number;
  financeRevenueCents: number;
  depositAppliedCents: number;
  downPaymentCents: number;
  financedAmountCents: number;
  taxableAmountCents: number;
  taxTotalCents: number;
  totalCents: number;
  balanceDueCents: number;
  costOfSaleCents?: number;
  tradeIn: {
    id: string;
    description: string;
    appraisedValueCents: number;
    tradeAllowanceCents: number;
    lienPayoffCents: number;
    netTradeValueCents: number;
  } | null;
  taxLines: Array<{
    taxType: string;
    province: string;
    rate: string;
    taxableCents: number;
    amountCents: number;
    isReversal: boolean;
  }>;
  invoices: Array<{
    id: string;
    number: string;
    totalCents: number;
    paidCents: number;
    status: string;
  }>;
  journalEntryId?: string | null;
  reversalEntryId?: string | null;
  notes: string | null;
}

export default function SaleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAccounting();
  const { data, error, isPending } = useAcctQuery<SaleDetail>(['sale', id], `/sales/${id}`);
  const [reversing, setReversing] = useState(false);
  const postDraft = useAcctMutation(() => acct.post(`/sales/drafts/${id}/post`));
  const deleteDraft = useAcctMutation(
    () => acct.delete(`/sales/drafts/${id}`),
    () => router.push('/dealer/accounting/sales'),
  );

  if (isPending && !data) return <Spinner />;
  if (error || !data) return <ErrorAlert error={error} />;

  return (
    <>
      <PageHeader
        title={`Deal #${data.number}`}
        description={`${vehicleLabel(data.vehicle)} · ${data.customer.name}`}
        actions={
          <>
            {data.status === 'DRAFT' ? (
              <>
                <Link href={`/dealer/accounting/sales/new?draft=${data.id}`}>
                  <Button variant="outline">Edit draft</Button>
                </Link>
                <Button
                  variant="outline"
                  loading={deleteDraft.isPending}
                  onClick={() => deleteDraft.mutate(undefined)}
                >
                  Delete draft
                </Button>
                {can('accounting.post_sales') ? (
                  <Button loading={postDraft.isPending} onClick={() => postDraft.mutate(undefined)}>
                    Post sale
                  </Button>
                ) : null}
              </>
            ) : null}
            {data.status === 'POSTED' &&
            can('accounting.reverse') &&
            can('accounting.post_sales') ? (
              <Button variant="destructive" onClick={() => setReversing(true)}>
                Reverse sale
              </Button>
            ) : null}
          </>
        }
      />
      <ErrorAlert error={postDraft.error ?? deleteDraft.error} className="mb-4" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deal</CardTitle>
          </CardHeader>
          <CardContent>
            <Facts
              items={[
                [
                  'Status',
                  <StatusBadge
                    key="s"
                    status={data.status === 'VOID' ? 'REVERSED' : data.status}
                  />,
                ],
                ['Sale date', isoDate(data.saleDate)],
                ['Vehicle', vehicleLabel(data.vehicle)],
                [
                  'VIN',
                  <span key="v" className="font-mono text-xs">
                    {data.vehicle.vin ?? '—'}
                  </span>,
                ],
                ['Customer', data.customer.name],
                [
                  'Salesperson',
                  data.salesperson
                    ? `${data.salesperson.firstName} ${data.salesperson.lastName}`
                    : '—',
                ],
                ['Tax province', data.taxProvince],
                ['Finance lender', data.financeLender?.name ?? '—'],
                ...(data.journalEntryId
                  ? ([
                      [
                        'Journal entry',
                        <Link
                          key="j"
                          href={`/dealer/accounting/journal/${data.journalEntryId}`}
                          className="text-primary hover:underline"
                        >
                          Open
                        </Link>,
                      ],
                    ] as Array<[string, React.ReactNode]>)
                  : []),
                ...(data.reversalEntryId
                  ? ([
                      [
                        'Reversal entry',
                        <Link
                          key="r"
                          href={`/dealer/accounting/journal/${data.reversalEntryId}`}
                          className="text-primary hover:underline"
                        >
                          Open
                        </Link>,
                      ],
                    ] as Array<[string, React.ReactNode]>)
                  : []),
              ]}
            />
            {data.notes ? (
              <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{data.notes}</p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Amounts</CardTitle>
          </CardHeader>
          <CardContent>
            <Facts
              items={[
                ['Vehicle price', <Amount key="1" cents={data.salePriceCents} />],
                ...(data.discountCents
                  ? ([['Discount', <Amount key="2" cents={-data.discountCents} />]] as Array<
                      [string, React.ReactNode]
                    >)
                  : []),
                [
                  'Fees and add-ons',
                  <Amount
                    key="3"
                    cents={
                      data.documentationFeeCents +
                      data.dealerFeesCents +
                      data.accessoriesCents +
                      data.warrantyCents +
                      data.otherChargesCents
                    }
                  />,
                ],
                ['Tax', <Amount key="4" cents={data.taxTotalCents} />],
                ['Total', <Amount key="5" cents={data.totalCents} strong />],
                ['Deposits applied', <Amount key="6" cents={data.depositAppliedCents} />],
                ['Down payment', <Amount key="7" cents={data.downPaymentCents} />],
                ['Financed', <Amount key="8" cents={data.financedAmountCents} />],
                ['Balance due', <Amount key="9" cents={data.balanceDueCents} strong />],
                ...(data.costOfSaleCents !== undefined && data.status === 'POSTED'
                  ? ([
                      [
                        'Cost of sale (book value)',
                        <Amount key="c" cents={data.costOfSaleCents} />,
                      ],
                      [
                        'Gross profit',
                        <Link
                          key="g"
                          href={`/dealer/accounting/vehicles/${data.vehicle.id}`}
                          className="text-primary hover:underline"
                        >
                          See vehicle profitability
                        </Link>,
                      ],
                    ] as Array<[string, React.ReactNode]>)
                  : []),
              ]}
            />
          </CardContent>
        </Card>
        {data.tradeIn ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trade-in</CardTitle>
            </CardHeader>
            <CardContent>
              <Facts
                items={[
                  ['Vehicle', data.tradeIn.description],
                  [
                    'Appraised (actual cash value)',
                    <Amount key="a" cents={data.tradeIn.appraisedValueCents} />,
                  ],
                  ['Allowance', <Amount key="b" cents={data.tradeIn.tradeAllowanceCents} />],
                  ['Lien payoff', <Amount key="c" cents={data.tradeIn.lienPayoffCents} />],
                  [
                    'Net trade value',
                    <Amount key="d" cents={data.tradeIn.netTradeValueCents} strong />,
                  ],
                ]}
              />
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tax</CardTitle>
          </CardHeader>
          <CardContent>
            {data.taxLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {data.status === 'DRAFT'
                  ? 'Tax is recorded when the sale posts.'
                  : 'No tax recorded.'}
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.taxLines.map((line, index) => (
                  <li key={index} className="flex justify-between gap-2">
                    <span>
                      {line.taxType} {formatRate(line.rate)} ({line.province}) on{' '}
                      {money(line.taxableCents)}
                      {line.isReversal ? ' · reversed' : ''}
                    </span>
                    <Amount cents={line.amountCents} />
                  </li>
                ))}
              </ul>
            )}
            {data.invoices.length > 0 ? (
              <div className="mt-4">
                <p className="mb-1 text-sm font-medium">Invoices</p>
                <ul className="space-y-1 text-sm">
                  {data.invoices.map((invoice) => (
                    <li key={invoice.id} className="flex justify-between gap-2">
                      <Link
                        href={`/dealer/accounting/receivables?invoice=${invoice.id}`}
                        className="text-primary hover:underline"
                      >
                        {invoice.number}
                      </Link>
                      <span className="flex items-center gap-2">
                        <StatusBadge status={invoice.status} />
                        <Amount cents={invoice.totalCents - invoice.paidCents} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardContent className="pt-5">
            <Attachments entityType="VehicleSale" entityId={data.id} />
          </CardContent>
        </Card>
      </div>
      <ReasonDialog
        open={reversing}
        title="Reverse this sale"
        description="Posts an equal and opposite entry for the whole deal: revenue, tax, cost of sale and receivables. The vehicle returns to stock."
        confirmLabel="Reverse sale"
        onClose={() => setReversing(false)}
        onConfirm={(reason) => acct.post(`/sales/${data.id}/reverse`, { reason })}
      />
    </>
  );
}
