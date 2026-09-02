'use client';

import { useRouter } from 'next/navigation';
import { useFavourites } from '@/lib/queries';
import { Button, StateMessage } from '@/components/ui';
import { AppBar } from '@/components/app-bar';
import { RequireAuth } from '@/components/require-auth';
import { VehicleCard, VehicleCardSkeleton } from '@/components/vehicle-card';
import { ErrorState } from '@/components/error-state';

export default function SavedPage() {
  return (
    <>
      <AppBar title="Saved" />
      <RequireAuth>
        <SavedList />
      </RequireAuth>
    </>
  );
}

function SavedList() {
  const router = useRouter();
  const favourites = useFavourites();
  const vehicles = favourites.data?.items ?? [];

  if (favourites.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 p-3">
        <VehicleCardSkeleton />
        <VehicleCardSkeleton />
      </div>
    );
  }

  if (favourites.isError) {
    return <ErrorState error={favourites.error} onRetry={() => void favourites.refetch()} />;
  }

  if (vehicles.length === 0) {
    return (
      <StateMessage
        title="Nothing saved yet"
        description="Tap the heart on any vehicle to keep it here."
        action={<Button onClick={() => router.push('/browse')}>Browse inventory</Button>}
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 p-3">
      {vehicles.map((vehicle) => (
        <VehicleCard key={vehicle.id} vehicle={vehicle} />
      ))}
    </div>
  );
}
