import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ListingSummary, Paginated } from '@atlas/shared';
import { api } from '../lib/api-client';
import { ListingCard, ListingCardSkeleton } from '../components/ListingCard';
import { EmptyState, ErrorAlert, Pagination } from '../components/ui';

export function FavouritesPage() {
  const [page, setPage] = useState(1);

  const { data, isPending, error } = useQuery({
    queryKey: ['favourites', page],
    queryFn: () => api.get<Paginated<ListingSummary>>(`/me/favourites?page=${page}&pageSize=12`),
  });

  return (
    <>
      <div className="panel-header">
        <h1>Saved vehicles</h1>
        {data && data.total > 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {data.total} saved
          </p>
        ) : null}
      </div>

      <ErrorAlert error={error} />

      {isPending ? (
        <div className="listing-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <ListingCardSkeleton key={index} />
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <>
          <div className="listing-grid">
            {data.items.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <div className="panel">
          <EmptyState
            title="No saved vehicles yet"
            action={
              <Link to="/listings" className="btn">
                Browse listings
              </Link>
            }
          >
            Tap the heart on any listing to save it here for later.
          </EmptyState>
        </div>
      )}
    </>
  );
}
