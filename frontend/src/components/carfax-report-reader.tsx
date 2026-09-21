'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Save, XCircle } from 'lucide-react';
import type { VehicleDetail } from '@vintrax/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDate, formatRelativeTime } from '@/lib/utils';
import { Button, ErrorAlert, Field, Input, Spinner } from '@/components/ui';

/**
 * The CARFAX report link, and what Vintrax's own read of it produced.
 *
 * Saving a new or changed link starts an extraction in the background — the
 * save itself never waits on it. What this shows below the link is read-only:
 * the two badges and the accident timeline are written by that extraction,
 * not typed here, so there is nothing left for the dealer to tick. A failed
 * extraction is shown as a warning rather than hidden; it never blocks
 * saving the vehicle.
 */
export function CarfaxReportReader({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient();

  const vehicleQuery = useQuery({
    queryKey: ['vehicle-history', vehicleId],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${vehicleId}`),
    // While an extraction this page just started is still running, poll for
    // it to land rather than making the dealer refresh the page to find out.
    // Capped by the pending window below, so a page left open does not poll
    // forever.
    refetchInterval: (query) => {
      const data = query.state.data as VehicleDetail | undefined;
      return data && isExtractionPending(data) ? 3_000 : false;
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['vehicle-history', vehicleId] });
    void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
  };

  // Loaded once from the server, the way the timeline editor loads its rows
  // once — otherwise a background refetch triggered by another mutation on
  // this page would overwrite whatever the dealer is mid-way through typing.
  const [carfaxUrl, setCarfaxUrl] = useState('');
  const [showVehicleHistory, setShowVehicleHistory] = useState(false);
  const [linkLoaded, setLinkLoaded] = useState(false);
  const [linkSaved, setLinkSaved] = useState(false);
  // Set to the moment a save changes the link, so the status below can tell
  // "extraction has not caught up to this save yet" from "extraction ran and
  // found nothing" — both look like a fetchedAt earlier than now otherwise.
  const [pendingSince, setPendingSince] = useState<number | null>(null);

  useEffect(() => {
    if (!vehicleQuery.data || linkLoaded) return;
    setCarfaxUrl(vehicleQuery.data.carfaxUrl ?? '');
    setShowVehicleHistory(vehicleQuery.data.showVehicleHistory);
    setLinkLoaded(true);
  }, [vehicleQuery.data, linkLoaded]);

  function isExtractionPending(vehicle: VehicleDetail): boolean {
    if (!vehicle.carfaxUrl) return false;
    if (pendingSince === null) return false;
    const fetchedAt = vehicle.carfaxFetchedAt ? new Date(vehicle.carfaxFetchedAt).getTime() : 0;
    // Give up after two minutes rather than polling indefinitely if a job is
    // stuck — the dealer can still save again, which starts a fresh attempt.
    if (Date.now() - pendingSince > 120_000) return false;
    return fetchedAt < pendingSince;
  }

  const saveLink = useMutation({
    mutationFn: (next: { carfaxUrl: string; showVehicleHistory: boolean }) =>
      api.patch<VehicleDetail>(`/vehicles/${vehicleId}`, {
        // Sent as an empty string when cleared, not omitted: omitting it would
        // leave the stored value in place, so a seller could never remove a
        // link once set.
        carfaxUrl: next.carfaxUrl.trim(),
        showVehicleHistory: next.showVehicleHistory,
      }),
    onSuccess: (_vehicle, next) => {
      setLinkSaved(true);
      const nextUrl = next.carfaxUrl.trim();
      if (nextUrl !== (vehicleQuery.data?.carfaxUrl ?? '') && nextUrl.length > 0) {
        setPendingSince(Date.now());
      }
      invalidate();
    },
  });

  if (vehicleQuery.isPending) return <Spinner label="Loading the CARFAX status" />;

  const linkError = saveLink.error instanceof ApiError ? saveLink.error : null;
  const vehicle = vehicleQuery.data;
  const pending = vehicle ? isExtractionPending(vehicle) : false;

  return (
    <div className="flex flex-col gap-4">
      <ErrorAlert error={vehicleQuery.error ?? saveLink.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="CARFAX report link (optional)"
          htmlFor="carfaxUrl"
          error={linkError?.fieldError('carfaxUrl')}
          hint="The share link CARFAX gave you, starting https://vhr.carfax.ca/. Vintrax reads the one-owner and low-kilometre badges and the accident record from it automatically."
        >
          <Input
            id="carfaxUrl"
            type="url"
            inputMode="url"
            placeholder="https://vhr.carfax.ca/..."
            value={carfaxUrl}
            onChange={(e) => {
              setLinkSaved(false);
              setCarfaxUrl(e.target.value);
            }}
          />
        </Field>
      </div>

      {vehicle ? <CarfaxStatus vehicle={vehicle} pending={pending} /> : null}

      {/* Independent of the link and the badges above: a dealer can hold a
          report they are not ready to publish the timeline from yet, or
          publish it once they have checked the extraction against their own
          copy. Never disabled — turning it off is always available, with or
          without a link on file. */}
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={showVehicleHistory}
          onChange={(e) => {
            setLinkSaved(false);
            setShowVehicleHistory(e.target.checked);
          }}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
        />
        <span>
          <span className="font-medium">Show vehicle history on the public listing</span>
          <span className="block text-muted-foreground">
            Publishes the accident record Vintrax reads from the CARFAX link above. The link and
            badges show either way; this only controls the timeline section.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          loading={saveLink.isPending}
          onClick={() => saveLink.mutate({ carfaxUrl, showVehicleHistory })}
        >
          <Save className="mr-2 h-4 w-4" aria-hidden />
          Save
        </Button>
        {linkSaved ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
      </div>
    </div>
  );
}

/**
 * What the extraction found, or is still finding.
 *
 * Entirely read-only: there is nothing here for a dealer to tick, only what
 * Vintrax's own read of the report produced. `null` on a badge means the
 * report did not state it, which is shown as "not stated" rather than as a
 * quiet "no" — see the field's own doc comment in the shared contracts.
 */
function CarfaxStatus({ vehicle, pending }: { vehicle: VehicleDetail; pending: boolean }) {
  if (!vehicle.carfaxUrl) return null;

  if (pending) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
        Checking your CARFAX report — this usually takes under a minute.
      </div>
    );
  }

  if (vehicle.carfaxFetchError) {
    return (
      <div className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
        <div className="flex items-center gap-2 font-medium text-destructive">
          <XCircle className="h-4 w-4 shrink-0" aria-hidden />
          Vintrax could not read this report automatically
        </div>
        <p className="text-muted-foreground">{vehicle.carfaxFetchError}</p>
        <p className="text-muted-foreground">
          The link and CARFAX mark still show on the listing. You can still record accidents
          yourself in the timeline editor below.
          {vehicle.carfaxFetchedAt
            ? ` Last tried ${formatRelativeTime(vehicle.carfaxFetchedAt)}.`
            : ''}
        </p>
      </div>
    );
  }

  if (!vehicle.carfaxFetchedAt) return null;

  const carfaxEvents = vehicle.historyEvents.filter((event) => event.source === 'CARFAX');
  const accidents = carfaxEvents.filter((event) => event.kind !== 'NO_ACCIDENTS');
  const statedAccidentFree = carfaxEvents.some((event) => event.kind === 'NO_ACCIDENTS');

  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
      <div className="w-full text-muted-foreground">
        <p>
          Read {formatRelativeTime(vehicle.carfaxFetchedAt)}. Low Kilometre:{' '}
          {vehicle.carfaxLowKilometres ? 'Yes' : 'Not stated'}. One Owner:{' '}
          {vehicle.carfaxOneOwner ? 'Yes' : vehicle.carfaxOneOwner === false ? 'No' : 'Not stated'}.
        </p>

        {accidents.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {accidents.map((event) => (
              <li key={event.id}>
                {event.occurredOn ? formatDate(event.occurredOn) : 'Undated'} — {event.label}
              </li>
            ))}
          </ul>
        ) : statedAccidentFree ? (
          <p className="mt-1.5">No accidents or damage reported.</p>
        ) : null}

        <p className="mt-1.5">
          {vehicle.showVehicleHistory
            ? 'Showing on the public listing.'
            : 'Turn on “Show vehicle history” below to publish what it found on the listing.'}
        </p>
      </div>
    </div>
  );
}
