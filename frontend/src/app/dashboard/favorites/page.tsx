'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import type { Paginated, VehicleSummary } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { Button, Card, EmptyState, ErrorAlert, Pagination } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { DashboardNav } from '@/components/dashboard-nav';
import { VehicleCard, VehicleCardSkeleton } from '@/components/vehicle-card';

function Favorites() {
  const [page, setPage] = useState(1);

  const { data, isPending, error } = useQuery({
    queryKey: ['favourites', page],
    queryFn: () => api.get<Paginated<VehicleSummary>>(`/me/favourites?page=${page}&pageSize=12`),
  });

  return (
    <div className="container py-8">
      <DashboardNav />

      <h1 className="mb-6 text-3xl font-bold tracking-tight">Saved vehicles</h1>
      <ErrorAlert error={error} className="mb-5" />

      {isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <VehicleCardSkeleton key={index} />
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {data.items.map((vehicle) => (
              <VehicleCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<Heart className="h-8 w-8" aria-hidden />}
            title="No saved vehicles yet"
            description="Tap the heart on any vehicle to save it here."
            action={
              <Link href="/vehicles">
                <Button>Browse vehicles</Button>
              </Link>
            }
          />
        </Card>
      )}
    </div>
  );
}

export default function FavoritesPage() {
  return (
    <RequireAuth>
      <Favorites />
    </RequireAuth>
  );
}
