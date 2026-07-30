import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListingStatus, ListingSummary, Paginated } from '@atlas/shared';
import { api } from '../lib/api-client';
import { useAuth } from '../auth/auth-context';
import { Badge, EmptyState, ErrorAlert, ListingImage, Pagination, Spinner } from '../components/ui';
import { formatEnum, formatKm, formatPrice, formatRelativeTime } from '../lib/format';

const TABS: Array<{ label: string; status?: ListingStatus }> = [
  { label: 'All' },
  { label: 'Live', status: 'ACTIVE' },
  { label: 'Drafts', status: 'DRAFT' },
  { label: 'Sold', status: 'SOLD' },
  { label: 'Archived', status: 'ARCHIVED' },
];

const STATUS_TONE = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  SOLD: 'accent',
  ARCHIVED: 'neutral',
} as const;

function DashboardRow({ listing }: { listing: ListingSummary }) {
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['my-listings'] });
    void queryClient.invalidateQueries({ queryKey: ['listings'] });
  };

  const changeStatus = useMutation({
    mutationFn: (status: ListingStatus) => api.patch(`/listings/${listing.id}`, { status }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/listings/${listing.id}`),
    onSuccess: invalidate,
  });

  return (
    <div
      className="card"
      style={{ display: 'flex', gap: '1rem', padding: '1rem', alignItems: 'flex-start' }}
    >
      <div style={{ width: 120, flex: 'none', aspectRatio: '4 / 3', borderRadius: 8, overflow: 'hidden' }}>
        <ListingImage src={listing.primaryImageUrl} alt="" />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="inline-row" style={{ justifyContent: 'space-between' }}>
          <Link to={`/listings/${listing.id}`} style={{ fontWeight: 650 }}>
            {listing.title}
          </Link>
          <Badge tone={STATUS_TONE[listing.status]}>{formatEnum(listing.status)}</Badge>
        </div>

        <p className="muted" style={{ margin: '0.35rem 0', fontSize: '0.9rem' }}>
          {formatPrice(listing.priceCad)} · {formatKm(listing.mileageKm)} · updated{' '}
          {formatRelativeTime(listing.createdAt)}
        </p>

        <ErrorAlert error={changeStatus.error ?? remove.error} />

        <div className="inline-row" style={{ gap: '0.5rem' }}>
          <Link to={`/dashboard/listings/${listing.id}`} className="btn btn-secondary btn-sm">
            Edit
          </Link>

          {listing.status === 'DRAFT' ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => changeStatus.mutate('ACTIVE')}
              disabled={changeStatus.isPending}
            >
              Publish
            </button>
          ) : null}

          {listing.status === 'ACTIVE' ? (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => changeStatus.mutate('SOLD')}
                disabled={changeStatus.isPending}
              >
                Mark as sold
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => changeStatus.mutate('DRAFT')}
                disabled={changeStatus.isPending}
              >
                Unpublish
              </button>
            </>
          ) : null}

          {confirmingDelete ? (
            <>
              <span style={{ fontSize: '0.88rem' }}>Delete permanently?</span>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                Yes, delete
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [page, setPage] = useState(1);

  const status = TABS[activeTab]?.status;
  const query = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (status) query.set('status', status);

  const { data, isPending, error } = useQuery({
    queryKey: ['my-listings', status ?? 'ALL', page],
    queryFn: () => api.get<Paginated<ListingSummary>>(`/listings/mine?${query.toString()}`),
  });

  // Counts come from the unfiltered query so the tiles do not change with tabs.
  const { data: all } = useQuery({
    queryKey: ['my-listings', 'ALL', 'stats'],
    queryFn: () => api.get<Paginated<ListingSummary>>('/listings/mine?pageSize=60'),
  });

  const stats = {
    total: all?.total ?? 0,
    active: all?.items.filter((item) => item.status === 'ACTIVE').length ?? 0,
    drafts: all?.items.filter((item) => item.status === 'DRAFT').length ?? 0,
  };

  return (
    <>
      <div className="panel-header">
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>My listings</h1>
          <p className="muted" style={{ margin: 0 }}>
            Signed in as {user?.dealership?.name ?? user?.displayName}
          </p>
        </div>
        <Link to="/dashboard/listings/new" className="btn">
          + New listing
        </Link>
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total listings</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats.active}</div>
          <div className="stat-label">Live now</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats.drafts}</div>
          <div className="stat-label">Drafts</div>
        </div>
      </div>

      <div className="tab-row" role="tablist" aria-label="Filter listings by status">
        {TABS.map((tab, index) => (
          <button
            key={tab.label}
            type="button"
            role="tab"
            className="tab"
            aria-selected={index === activeTab}
            onClick={() => {
              setActiveTab(index);
              setPage(1);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ErrorAlert error={error} />

      {isPending ? (
        <Spinner label="Loading your listings" />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="stack">
            {data.items.map((listing) => (
              <DashboardRow key={listing.id} listing={listing} />
            ))}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <div className="panel">
          <EmptyState
            title="Nothing here yet"
            action={
              <Link to="/dashboard/listings/new" className="btn">
                Create your first listing
              </Link>
            }
          >
            Listings you create will appear here, including drafts that are not yet public.
          </EmptyState>
        </div>
      )}
    </>
  );
}
