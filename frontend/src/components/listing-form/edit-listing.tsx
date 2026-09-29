'use client';

import { useQuery } from '@tanstack/react-query';
import type { VehicleDetail } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { ErrorAlert, Spinner } from '@/components/ui';
import { ListingForm } from './listing-form';
import { draftFromVehicle } from './listing-draft';

/** The listing form, filled in from a saved vehicle. */
export function EditListing({ vehicleId }: { vehicleId: string }) {
  const vehicle = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${vehicleId}`),
    // Refetching while the dealer types would not replace their draft, but
    // there is no reason to ask either.
    refetchOnWindowFocus: false,
  });

  if (vehicle.isPending) return <Spinner label="Loading vehicle" />;
  if (vehicle.error) return <ErrorAlert error={vehicle.error} />;
  return (
    <ListingForm
      key={vehicle.data.id}
      initial={draftFromVehicle(vehicle.data)}
      vehicleId={vehicle.data.id}
      status={vehicle.data.status}
    />
  );
}
