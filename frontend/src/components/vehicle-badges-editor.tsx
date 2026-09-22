'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import {
  VEHICLE_BADGE_KEYS,
  VEHICLE_BADGE_LABELS,
  type VehicleBadges,
  type VehicleDetail,
} from '@vintrax/shared';
import { ApiError, api } from '@/lib/api-client';
import { Button, ErrorAlert, Field, Input } from '@/components/ui';

const NO_BADGES: VehicleBadges = {
  lowKilometres: false,
  oneOwner: false,
  noAccident: false,
  report: false,
  carfax: false,
};

/**
 * Where the dealer sets the five vehicle-history badges directly, and the
 * associated CARFAX report link (issue #67, superseding D-047's automatic
 * extraction). Nothing here is read from any report — every value is exactly
 * what the dealer ticked, saved as-is, and shown everywhere the app draws a
 * vehicle's badges from the same `vehicle.badges` object this form writes.
 */
export function VehicleBadgesEditor({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient();

  const vehicleQuery = useQuery({
    queryKey: ['vehicle-history', vehicleId],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${vehicleId}`),
  });

  // Loaded once, the same way the timeline editor loads its rows once —
  // otherwise a background refetch triggered by another mutation on this page
  // would overwrite whatever the dealer is mid-way through ticking.
  const [carfaxUrl, setCarfaxUrl] = useState('');
  const [badges, setBadges] = useState<VehicleBadges>(NO_BADGES);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!vehicleQuery.data || loaded) return;
    setCarfaxUrl(vehicleQuery.data.carfaxUrl ?? '');
    setBadges(vehicleQuery.data.badges);
    setLoaded(true);
  }, [vehicleQuery.data, loaded]);

  const save = useMutation({
    mutationFn: () =>
      api.patch<VehicleDetail>(`/vehicles/${vehicleId}`, {
        // Sent as an empty string when cleared, not omitted: omitting it
        // would leave the stored value in place, so a dealer could never
        // remove a link once set.
        carfaxUrl: carfaxUrl.trim(),
        badgeLowKilometres: badges.lowKilometres,
        badgeOneOwner: badges.oneOwner,
        badgeNoAccident: badges.noAccident,
        badgeReport: badges.report,
        badgeCarfax: badges.carfax,
      }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['vehicle-history', vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
    },
  });

  if (vehicleQuery.isPending) return null;

  const saveError = save.error instanceof ApiError ? save.error : null;

  return (
    <div className="flex flex-col gap-4">
      <ErrorAlert error={vehicleQuery.error ?? save.error} />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Vehicle history</legend>
        {VEHICLE_BADGE_KEYS.map((key) => (
          <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={badges[key]}
              onChange={(e) => {
                setSaved(false);
                setBadges((current) => ({ ...current, [key]: e.target.checked }));
              }}
              className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
            />
            {VEHICLE_BADGE_LABELS[key]}
          </label>
        ))}
      </fieldset>

      <Field
        label="CARFAX report link (optional)"
        htmlFor="carfaxUrl"
        error={saveError?.fieldError('carfaxUrl')}
        hint="The share link CARFAX gave you, starting https://vhr.carfax.ca/. Associated with this listing for reference — ticking the CARFAX badge above is what shows the badge, independently of this link."
      >
        <Input
          id="carfaxUrl"
          type="url"
          inputMode="url"
          placeholder="https://vhr.carfax.ca/..."
          value={carfaxUrl}
          onChange={(e) => {
            setSaved(false);
            setCarfaxUrl(e.target.value);
          }}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
          <Save className="mr-2 h-4 w-4" aria-hidden />
          Save
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
      </div>
    </div>
  );
}
