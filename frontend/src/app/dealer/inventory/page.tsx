'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type {
  ListingStatus,
  Paginated,
  SellerSettableListingStatus,
  VehicleSummary,
} from '@atlas/shared';
import { api } from '@/lib/api-client';
import { formatEnum, formatKm, formatPrice } from '@/lib/utils';
import { Badge, Button, Card, CardContent, EmptyState, ErrorAlert, Pagination, Spinner } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';

const TABS: Array<{ label: string; status?: ListingStatus }> = [
  { label: 'All' },
  { label: 'Live', status: 'ACTIVE' },
  { label: 'In auction', status: 'IN_AUCTION' },
  { label: 'Drafts', status: 'DRAFT' },
  // Without these two a listing awaiting moderation, or one the seller
  // archived, is reachable only from the "All" tab.
  { label: 'In review', status: 'PENDING_REVIEW' },
  { label: 'Sold', status: 'SOLD' },
  { label: 'Archived', status: 'ARCHIVED' },
];

const STATUS_VARIANT = {
  DRAFT: 'outline', PENDING_REVIEW: 'warning', ACTIVE: 'success',
  IN_AUCTION: 'accent', SOLD: 'default', ARCHIVED: 'outline',
} as const;

function InventoryRow({ vehicle }: { vehicle: VehicleSummary }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['my-inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
  };

  // Status has its own endpoint, and a seller cannot reach ACTIVE through it —
  // publishing is a moderation decision, so "Submit for review" is as far as
  // this page goes. PATCH /vehicles/:id no longer accepts the field at all.
  const changeStatus = useMutation({
    mutationFn: (status: SellerSettableListingStatus) =>
      api.patch(`/vehicles/${vehicle.id}/status`, { status }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/vehicles/${vehicle.id}`),
    onSuccess: invalidate,
  });

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 pt-5">
        <div className="h-20 w-28 shrink-0 overflow-hidden rounded-md bg-muted">
          {vehicle.primaryImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={vehicle.primaryImageUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>

        <div className="min-w-[200px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/vehicles/${vehicle.slug}`} className="font-semibold hover:text-primary">
              {vehicle.title}
            </Link>
            <Badge variant={STATUS_VARIANT[vehicle.status]}>{formatEnum(vehicle.status)}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatPrice(vehicle.priceCad)} · {formatKm(vehicle.mileageKm)}
          </p>

          <ErrorAlert error={changeStatus.error ?? remove.error} className="mt-2" />

          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/dealer/inventory/${vehicle.id}`}>
              <Button variant="outline" size="sm">Edit</Button>
            </Link>

            {vehicle.status === 'DRAFT' ? (
              <Button size="sm" loading={changeStatus.isPending} onClick={() => changeStatus.mutate('PENDING_REVIEW')}>
                Submit for review
              </Button>
            ) : null}

            {vehicle.status === 'PENDING_REVIEW' ? (
              <>
                <span className="self-center text-sm text-muted-foreground">
                  Awaiting moderation
                </span>
                <Button variant="ghost" size="sm" loading={changeStatus.isPending} onClick={() => changeStatus.mutate('DRAFT')}>
                  Withdraw
                </Button>
              </>
            ) : null}

            {vehicle.status === 'ACTIVE' ? (
              <>
                <Link href={`/auctions/new?vehicleId=${vehicle.id}`}>
                  <Button variant="accent" size="sm">Run auction</Button>
                </Link>
                <Button variant="ghost" size="sm" loading={changeStatus.isPending} onClick={() => changeStatus.mutate('DRAFT')}>
                  Unpublish
                </Button>
              </>
            ) : null}

            {vehicle.status === 'ARCHIVED' ? (
              <Button variant="outline" size="sm" loading={changeStatus.isPending} onClick={() => changeStatus.mutate('DRAFT')}>
                Restore to draft
              </Button>
            ) : null}

            {confirming ? (
              <>
                <span className="self-center text-sm">Delete permanently?</span>
                <Button variant="destructive" size="sm" loading={remove.isPending} onClick={() => remove.mutate()}>
                  Yes, delete
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>Delete</Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Inventory() {
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(1);
  const status = TABS[tab]?.status;

  const query = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (status) query.set('status', status);

  const { data, isPending, error } = useQuery({
    queryKey: ['my-inventory', status ?? 'ALL', page],
    queryFn: () => api.get<Paginated<VehicleSummary>>(`/vehicles/mine?${query.toString()}`),
  });

  return (
    <div className="container py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
        <Link href="/dealer/add-vehicle">
          <Button><Plus className="h-4 w-4" aria-hidden />Add vehicle</Button>
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap gap-1 border-b border-border" role="tablist">
        {TABS.map((entry, index) => (
          <button
            key={entry.label}
            type="button"
            role="tab"
            aria-selected={index === tab}
            onClick={() => { setTab(index); setPage(1); }}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              index === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <ErrorAlert error={error} className="mb-5" />

      {isPending ? (
        <Spinner />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="flex flex-col gap-3">
            {data.items.map((vehicle) => <InventoryRow key={vehicle.id} vehicle={vehicle} />)}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <Card>
          <EmptyState
            title="Nothing here yet"
            description="Vehicles you create appear here, including drafts that are not yet public."
            action={<Link href="/dealer/add-vehicle"><Button>Create your first listing</Button></Link>}
          />
        </Card>
      )}
    </div>
  );
}

export default function InventoryPage() {
  return <RequireAuth sellersOnly><Inventory /></RequireAuth>;
}
