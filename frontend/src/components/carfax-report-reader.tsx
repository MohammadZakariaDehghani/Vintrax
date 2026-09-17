'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, Save, ShieldCheck } from 'lucide-react';
import type { CarfaxReadResult, VehicleDetail } from '@vintrax/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';
import { Button, ErrorAlert, Field, Input, Spinner } from '@/components/ui';

/**
 * The CARFAX report link, what it says, and whether to publish it.
 *
 * This used to be four things a dealer had to find in three different places:
 * the link field lived in the listing form, the two report badges lived under
 * it, reading the report was its own card, and approving what was read was a
 * checkbox at the bottom of that card. All four are the same task — "manage
 * what this listing says about the vehicle's CARFAX report" — so they are one
 * block now, nested in the page's "Vehicle history" card above the seller's
 * own timeline entries.
 *
 * The link lives here rather than in the listing form for a reason beyond
 * tidiness: reading a report needs a vehicle id, so it was never useful before
 * the listing existed. Saving it through `PATCH /vehicles/:id` — the same
 * endpoint the listing form itself calls to save the rest of the vehicle — is
 * what keeps this a small, independent act rather than a second copy of
 * `updateVehicleSchema`'s validation.
 *
 * Reading and publishing stay separate acts, and that part is unchanged. The
 * thing being read is a page whose markup nobody promised us, and the dealer
 * has the report open in front of them — they are the only party who can tell
 * a correct reading from a plausible one. Press the button, see exactly what
 * the server took off the page, compare it against the report, then tick the
 * box. Nothing reaches a buyer in between: the API withholds an unapproved
 * reading from the public listing response rather than merely leaving it
 * undrawn.
 */
export function CarfaxReportReader({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<CarfaxReadResult | null>(null);

  // Its own query, the way the timeline editor has one. The page above is a
  // server component holding only an id, and this needs the stored link, the
  // stored reading and the approval flag, all of which change under it as it
  // is used.
  const vehicleQuery = useQuery({
    queryKey: ['vehicle-history', vehicleId],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${vehicleId}`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['vehicle-history', vehicleId] });
    void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
  };

  // The link and its two badges. Loaded once from the server, the way the
  // timeline editor loads its rows once — otherwise a background refetch
  // triggered by another mutation on this page would overwrite whatever the
  // dealer is mid-way through typing.
  const [linkForm, setLinkForm] = useState({
    carfaxUrl: '',
    carfaxOneOwner: false,
    carfaxLowKilometres: false,
  });
  const [linkLoaded, setLinkLoaded] = useState(false);
  const [linkSaved, setLinkSaved] = useState(false);

  useEffect(() => {
    if (!vehicleQuery.data || linkLoaded) return;
    setLinkForm({
      carfaxUrl: vehicleQuery.data.carfaxUrl ?? '',
      // Null means the seller was never asked, which presents as unticked. The
      // distinction is kept in the database, not in a tri-state checkbox that
      // nobody would understand.
      carfaxOneOwner: vehicleQuery.data.carfaxOneOwner ?? false,
      carfaxLowKilometres: vehicleQuery.data.carfaxLowKilometres ?? false,
    });
    setLinkLoaded(true);
  }, [vehicleQuery.data, linkLoaded]);

  const saveLink = useMutation({
    mutationFn: () =>
      api.patch<VehicleDetail>(`/vehicles/${vehicleId}`, {
        // Sent as an empty string when cleared, not omitted: omitting it would
        // leave the stored value in place, so a seller could never remove a
        // link once set. The service retires the two badges in the same write
        // when the link is cleared, so they do not need to be sent as false.
        carfaxUrl: linkForm.carfaxUrl.trim(),
        carfaxOneOwner: linkForm.carfaxOneOwner,
        carfaxLowKilometres: linkForm.carfaxLowKilometres,
      }),
    onSuccess: () => {
      setLinkSaved(true);
      setResult(null);
      invalidate();
    },
  });

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

  const linkError = saveLink.error instanceof ApiError ? saveLink.error : null;
  const linkFieldError = (field: string) => linkError?.fieldError(field);

  return (
    <div className="flex flex-col gap-4">
      <ErrorAlert error={vehicleQuery.error ?? saveLink.error ?? read.error ?? approve.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="CARFAX report link (optional)"
          htmlFor="carfaxUrl"
          error={linkFieldError('carfaxUrl')}
          hint="The share link CARFAX gave you, starting https://vhr.carfax.ca/."
        >
          <Input
            id="carfaxUrl"
            type="url"
            inputMode="url"
            placeholder="https://vhr.carfax.ca/..."
            value={linkForm.carfaxUrl}
            onChange={(e) => {
              setLinkSaved(false);
              setLinkForm((previous) => ({ ...previous, carfaxUrl: e.target.value }));
            }}
          />
        </Field>
      </div>

      {/* The two badges a CARFAX Canada report prints. They join the CARFAX
          mark into one strip on the listing rather than appearing beside it
          as separate chips.

          Disabled without a link, and the API refuses them too — the badge is
          defensible because it opens the report a buyer can check, and a claim
          with nothing behind it is that brand's authority with the evidence
          taken out. Disabled rather than hidden so a seller can see what
          adding the link would give them. */}
      <fieldset disabled={linkForm.carfaxUrl.trim().length === 0}>
        <legend className="text-sm font-medium">What the report shows</legend>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {linkForm.carfaxUrl.trim().length === 0
            ? 'Add the report link above to use these.'
            : 'Tick only what your own report states. These are published as your account of it — Vintrax does not check reports.'}
        </p>

        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {(
            [
              ['carfaxOneOwner', 'One Owner'],
              ['carfaxLowKilometres', 'Low Kilometres'],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2 text-sm disabled:cursor-not-allowed"
            >
              <input
                type="checkbox"
                checked={linkForm[key]}
                onChange={(e) => {
                  setLinkSaved(false);
                  setLinkForm((previous) => ({ ...previous, [key]: e.target.checked }));
                }}
                className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          loading={saveLink.isPending}
          onClick={() => saveLink.mutate()}
        >
          <Save className="mr-2 h-4 w-4" aria-hidden />
          Save link
        </Button>
        {linkSaved ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
      </div>

      <div className="border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
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
          ) : !hasLink ? (
            <span className="text-sm text-muted-foreground">
              Save a report link above to read it.
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
      </div>
    </div>
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
      {result.status === 'unreadable' && result.diagnosis ? (
        // Shown rather than only logged, so the person who hit it can report
        // it. Without this the failure is the same sentence whether the page
        // changed shape, was never a report, or draws itself in the browser —
        // which is exactly how the first real one wasted a round of guessing.
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-muted-foreground underline">
            What was on the page
          </summary>
          <p className="mt-1 break-words rounded bg-muted px-2 py-1.5 font-mono text-xs text-muted-foreground">
            {result.diagnosis}
          </p>
        </details>
      ) : null}
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
