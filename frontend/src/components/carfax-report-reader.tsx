'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import type { VehicleDetail } from '@vintrax/shared';
import { ApiError, api } from '@/lib/api-client';
import { Button, ErrorAlert, Field, Input, Spinner } from '@/components/ui';

/**
 * The CARFAX report link and the two badges a report prints.
 *
 * Reading a report and showing an accident timeline drawn from it used to
 * live here too. That auto-fetch could not reliably read CARFAX's share-link
 * pages — CARFAX serves a browser-rendered page with no accident section in
 * the markup itself — and was removed rather than continue chasing that.
 * Sellers wanting an accident timeline on the listing type one themselves in
 * the history editor below; this block only manages the link and badges that
 * sit beside the CARFAX button.
 */
export function CarfaxReportReader({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient();

  const vehicleQuery = useQuery({
    queryKey: ['vehicle-history', vehicleId],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${vehicleId}`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['vehicle-history', vehicleId] });
    void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
  };

  // Loaded once from the server, the way the timeline editor loads its rows
  // once — otherwise a background refetch triggered by another mutation on
  // this page would overwrite whatever the dealer is mid-way through typing.
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
      invalidate();
    },
  });

  if (vehicleQuery.isPending) return <Spinner label="Loading the CARFAX status" />;

  const linkError = saveLink.error instanceof ApiError ? saveLink.error : null;
  const linkFieldError = (field: string) => linkError?.fieldError(field);

  return (
    <div className="flex flex-col gap-4">
      <ErrorAlert error={vehicleQuery.error ?? saveLink.error} />

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
    </div>
  );
}
