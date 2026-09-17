'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, ShieldCheck } from 'lucide-react';
import type { CarfaxReadResult, VehicleDetail } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorAlert,
  Spinner,
} from '@/components/ui';

/**
 * Where a dealer reads their CARFAX report and decides whether to publish it.
 *
 * The order is the whole design. Reading is one action and publishing is
 * another, and they are separate because the thing being read is a page whose
 * markup nobody promised us. The dealer has the report open in front of them;
 * they are the only party who can tell a correct reading from a plausible one.
 *
 * So: press the button, see exactly what the server took off the page, compare
 * it against the report, then tick the box. Nothing reaches a buyer in between
 * — the API withholds an unapproved reading from the public listing response
 * rather than merely leaving it undrawn.
 *
 * The three outcomes are shown as three different things on purpose. "No
 * accidents reported" is a finding. "We could not read the page" is not a
 * finding, and is never dressed up as one: it says so plainly and tells the
 * dealer the timeline will stay as it was.
 */
export function CarfaxReportReader({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<CarfaxReadResult | null>(null);

  // Its own query, the way the timeline editor has one. The page above is a
  // server component holding only an id, and this needs the stored reading and
  // the approval flag, both of which change under it as it is used.
  const vehicleQuery = useQuery({
    queryKey: ['vehicle-history', vehicleId],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${vehicleId}`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['vehicle-history', vehicleId] });
    void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
  };

  const read = useMutation({
    mutationFn: () => api.post<CarfaxReadResult>(`/vehicles/${vehicleId}/carfax/read`, {}),
    onSuccess: (data) => {
      setResult(data);
      invalidate();
    },
  });

  const approve = useMutation({
    mutationFn: (approved: boolean) =>
      api.patch<VehicleDetail>(`/vehicles/${vehicleId}/carfax/history`, { approved }),
    onSuccess: invalidate,
  });

  if (vehicleQuery.isPending) return <Spinner label="Loading the CARFAX status" />;

  const vehicle = vehicleQuery.data;
  const hasLink = Boolean(vehicle?.carfaxUrl);
  // The stored reading, which outlives the one this session produced.
  const stored = (vehicle?.historyEvents ?? []).filter((event) => event.source === 'CARFAX');

  return (
    <Card>
      <CardHeader>
        <CardTitle>CARFAX accident record</CardTitle>
        <CardDescription>
          {hasLink ? (
            <>
              Reads the accident and damage section of the report you linked, and shows you what it
              found. Nothing appears on the listing until you have checked it against your own
              report and ticked the box.
            </>
          ) : (
            <>
              Add the report link in <strong>CARFAX report link</strong> above first. It must be the
              share link CARFAX gave you, starting <code>https://vhr.carfax.ca/</code>.
            </>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ErrorAlert error={vehicleQuery.error ?? read.error ?? approve.error} className="mb-4" />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={!hasLink}
            loading={read.isPending}
            onClick={() => read.mutate()}
          >
            <Download className="mr-2 h-4 w-4" aria-hidden />
            {vehicle?.carfaxFetchedAt ? 'Read the report again' : 'Read the report'}
          </Button>

          {vehicle?.carfaxFetchedAt ? (
            <span className="text-sm text-muted-foreground">
              Last read {formatDate(vehicle.carfaxFetchedAt)}.
            </span>
          ) : null}
        </div>

        {result ? <ReadOutcome result={result} /> : null}

        {stored.length > 0 ? (
          <div className="mt-5 border-t border-border pt-4">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                checked={vehicle?.carfaxHistoryApproved ?? false}
                disabled={approve.isPending}
                onChange={(changed) => approve.mutate(changed.target.checked)}
              />
              <span>
                <span className="font-medium">Show this on the vehicle listing.</span>{' '}
                <span className="text-muted-foreground">
                  Buyers see the timeline above the CARFAX button. Untick it and they see the button
                  alone.
                </span>
              </span>
            </label>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** What came back, said as what it is. */
function ReadOutcome({ result }: { result: CarfaxReadResult }) {
  if (result.status === 'ok' && result.records.length > 0) {
    return (
      <Panel tone="bad" icon={<AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />}>
        <p className="text-sm font-semibold text-destructive">
          {result.records.length === 1
            ? '1 accident or damage record read from the report'
            : `${result.records.length} accident or damage records read from the report`}
        </p>
        <ul className="mt-1.5 space-y-1">
          {result.records.map((record, index) => (
            <li key={index} className="text-sm">
              <span className="text-muted-foreground">
                {record.occurredOn ? formatDate(record.occurredOn) : 'No date read'}
              </span>{' '}
              — {record.label}
              {record.detail ? ` — ${record.detail}` : ''}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-muted-foreground">
          Check every line against your report before you publish it.
        </p>
      </Panel>
    );
  }

  if (result.status === 'ok') {
    return (
      <Panel tone="good" icon={<ShieldCheck className="h-4 w-4 text-success" aria-hidden />}>
        <p className="text-sm font-semibold text-success">
          The report states no accidents or damage.
        </p>
      </Panel>
    );
  }

  // Not a finding, and never presented as one. A page that could not be read
  // says nothing about the car.
  return (
    <Panel tone="warn" icon={<AlertTriangle className="h-4 w-4 text-warning" aria-hidden />}>
      <p className="text-sm font-semibold">
        {result.status === 'unreachable'
          ? 'The report could not be opened.'
          : 'The report opened, but its accident section could not be read.'}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {result.reason}. This says nothing about the vehicle — whatever was read before is
        unchanged. Check the link is the share link CARFAX gave you, and try again.
      </p>
    </Panel>
  );
}

function Panel({
  tone,
  icon,
  children,
}: {
  tone: 'good' | 'bad' | 'warn';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const border =
    tone === 'bad'
      ? 'border-destructive/30 bg-destructive/5'
      : tone === 'good'
        ? 'border-success/30 bg-success/5'
        : 'border-warning/40 bg-warning/5';

  return (
    <div className={`mt-4 flex items-start gap-2.5 rounded-md border px-3 py-2.5 ${border}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
