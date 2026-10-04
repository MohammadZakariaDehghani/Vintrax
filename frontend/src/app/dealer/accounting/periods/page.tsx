'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, CardContent, Dialog, ErrorAlert, Spinner } from '@/components/ui';
import { useAccounting } from '@/components/accounting/context';
import {
  PageHeader,
  ReasonDialog,
  StatusBadge,
  useAcctMutation,
  useAcctQuery,
} from '@/components/accounting/ui';
import { acct, isoDate } from '@/lib/accounting';

interface Period {
  id: string;
  number: number;
  name: string;
  quarter: number;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED';
  closedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  draftEntries: number;
}

interface FiscalYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED';
  closedAt: string | null;
  closingEntryId: string | null;
  periods: Period[];
}

type Action =
  | { kind: 'reopen-period'; period: Period }
  | { kind: 'reopen-year'; year: FiscalYear }
  | { kind: 'close-period'; period: Period };

export default function PeriodsPage() {
  const { can } = useAccounting();
  const { data, error, isPending } = useAcctQuery<FiscalYear[]>(['periods'], '/periods');
  const [action, setAction] = useState<Action | null>(null);
  const [closingYear, setClosingYear] = useState<FiscalYear | null>(null);

  return (
    <>
      <PageHeader
        title="Fiscal years and periods"
        description="Closing a period stops any posting dated inside it. Reopening needs a reason and is audited. The year-end close moves the year's profit into retained earnings."
      />
      {isPending && !data ? <Spinner /> : null}
      <ErrorAlert error={error} />
      <div className="space-y-6">
        {data?.map((year) => (
          <Card key={year.id}>
            <CardContent className="pt-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">
                    {year.name} <StatusBadge status={year.status} />
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {isoDate(year.startDate)} to {isoDate(year.endDate)}
                    {year.closingEntryId ? (
                      <>
                        {' · '}
                        <Link
                          href={`/dealer/accounting/journal/${year.closingEntryId}`}
                          className="text-primary hover:underline"
                        >
                          Closing entry
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex gap-2">
                  {year.status === 'OPEN' && can('accounting.close_period') ? (
                    <Button variant="outline" onClick={() => setClosingYear(year)}>
                      Close the year
                    </Button>
                  ) : null}
                  {year.status === 'CLOSED' && can('accounting.reopen_period') ? (
                    <Button
                      variant="outline"
                      onClick={() => setAction({ kind: 'reopen-year', year })}
                    >
                      Reopen the year
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {year.periods.map((period) => (
                  <div key={period.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{period.name}</span>
                      <StatusBadge status={period.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Q{period.quarter} · {isoDate(period.startDate)} – {isoDate(period.endDate)}
                    </p>
                    {period.draftEntries > 0 ? (
                      <Badge variant="warning" className="mt-1">
                        {period.draftEntries} draft entries
                      </Badge>
                    ) : null}
                    {period.reopenReason ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Reopened: {period.reopenReason}
                      </p>
                    ) : null}
                    <div className="mt-2">
                      {period.status === 'OPEN' &&
                      year.status === 'OPEN' &&
                      can('accounting.close_period') ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setAction({ kind: 'close-period', period })}
                        >
                          Close period
                        </Button>
                      ) : null}
                      {period.status === 'CLOSED' &&
                      year.status === 'OPEN' &&
                      can('accounting.reopen_period') ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setAction({ kind: 'reopen-period', period })}
                        >
                          Reopen
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ReasonDialog
        open={action?.kind === 'close-period'}
        optional
        destructive={false}
        title={action?.kind === 'close-period' ? `Close ${action.period.name}` : ''}
        description="Nothing dated in this period can be posted until it is reopened. Draft entries in it must be posted or deleted first."
        confirmLabel="Close period"
        onClose={() => setAction(null)}
        onConfirm={(reason) =>
          action?.kind === 'close-period'
            ? acct.post(`/periods/${action.period.id}/close`, { reason: reason || null })
            : Promise.resolve()
        }
      />
      <ReasonDialog
        open={action?.kind === 'reopen-period'}
        title={action?.kind === 'reopen-period' ? `Reopen ${action.period.name}` : ''}
        description="Changing a closed period changes figures you may already have reported or filed."
        confirmLabel="Reopen period"
        onClose={() => setAction(null)}
        onConfirm={(reason) =>
          action?.kind === 'reopen-period'
            ? acct.post(`/periods/${action.period.id}/reopen`, { reason })
            : Promise.resolve()
        }
      />
      <ReasonDialog
        open={action?.kind === 'reopen-year'}
        title={action?.kind === 'reopen-year' ? `Reopen ${action.year.name}` : ''}
        description="Reverses the closing entry, so the year's revenue and expenses are back in their accounts."
        confirmLabel="Reopen year"
        onClose={() => setAction(null)}
        onConfirm={(reason) =>
          action?.kind === 'reopen-year'
            ? acct.post(`/fiscal-years/${action.year.id}/reopen`, { reason })
            : Promise.resolve()
        }
      />
      {closingYear ? (
        <CloseYearDialog year={closingYear} onClose={() => setClosingYear(null)} />
      ) : null}
    </>
  );
}

function CloseYearDialog({ year, onClose }: { year: FiscalYear; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const close = useAcctMutation(
    () => acct.post(`/fiscal-years/${year.id}/close`, { confirm: true, reason: null }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Year-end close: ${year.name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!confirmed}
            loading={close.isPending}
            onClick={() => close.mutate(undefined)}
          >
            Close the year
          </Button>
        </>
      }
    >
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>
          A closing entry moves every revenue, cost and expense balance into Retained Earnings.
        </li>
        <li>Every period in the year is closed; nothing dated in it can be posted.</li>
        <li>The next fiscal year is opened.</li>
        <li>An accountant can reopen the year later; that reverses the closing entry.</li>
      </ul>
      <p className="mt-3 text-sm">
        Run the Accounting Health check and reconcile your bank accounts first.
      </p>
      <label className="mt-3 flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        I have reviewed the year and want to close it
      </label>
      <ErrorAlert error={close.error} className="mt-3" />
    </Dialog>
  );
}
