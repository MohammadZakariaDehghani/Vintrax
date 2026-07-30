import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ListingSummary } from '@atlas/shared';
import { api } from '../lib/api-client';
import { useAuth } from '../auth/auth-context';
import { formatEnum, formatKm, formatLocation, formatPrice, joinSpecs } from '../lib/format';
import { Badge, ListingImage } from './ui';

const STATUS_TONE = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  SOLD: 'accent',
  ARCHIVED: 'neutral',
} as const;

export function ListingCard({
  listing,
  showStatus = false,
}: {
  listing: ListingSummary;
  showStatus?: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const toggleFavourite = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) await api.put(`/listings/${listing.id}/favourite`);
      else await api.delete(`/listings/${listing.id}/favourite`);
    },
    onSuccess: () => {
      // Refresh anything showing favourite state: search, detail, the saved list.
      void queryClient.invalidateQueries({ queryKey: ['listings'] });
      void queryClient.invalidateQueries({ queryKey: ['favourites'] });
      void queryClient.invalidateQueries({ queryKey: ['listing', listing.id] });
    },
  });

  const specs = joinSpecs(
    formatKm(listing.mileageKm),
    formatEnum(listing.transmission),
    formatEnum(listing.fuelType),
  );

  return (
    <article className="listing-card">
      <div className="listing-card-media">
        <Link to={`/listings/${listing.id}`} tabIndex={-1} aria-hidden="true">
          <ListingImage src={listing.primaryImageUrl} alt="" />
        </Link>

        {user ? (
          <button
            type="button"
            className="favourite-btn"
            aria-pressed={listing.isFavourited}
            aria-label={
              listing.isFavourited
                ? `Remove ${listing.title} from favourites`
                : `Save ${listing.title} to favourites`
            }
            disabled={toggleFavourite.isPending}
            onClick={() => toggleFavourite.mutate(!listing.isFavourited)}
          >
            {listing.isFavourited ? '♥' : '♡'}
          </button>
        ) : null}

        {listing.imageCount > 1 ? (
          <span className="image-count">{listing.imageCount} photos</span>
        ) : null}
      </div>

      <div className="listing-card-body">
        <Link to={`/listings/${listing.id}`} className="listing-card-link">
          <h3 className="listing-card-title">{listing.title}</h3>
        </Link>

        <div className="listing-price">{formatPrice(listing.priceCad)}</div>
        <div className="listing-meta">{specs}</div>

        <div className="listing-card-footer">
          <span>{formatLocation(listing.city, listing.province)}</span>
          {showStatus ? (
            <Badge tone={STATUS_TONE[listing.status]}>{formatEnum(listing.status)}</Badge>
          ) : (
            <span>{formatEnum(listing.condition)}</span>
          )}
        </div>
      </div>
    </article>
  );
}

export function ListingCardSkeleton() {
  return (
    <div className="listing-card" aria-hidden="true">
      <div className="listing-card-media skeleton" />
      <div className="listing-card-body">
        <div className="skeleton" style={{ height: 18, width: '85%' }} />
        <div className="skeleton" style={{ height: 22, width: '45%' }} />
        <div className="skeleton" style={{ height: 14, width: '70%' }} />
      </div>
    </div>
  );
}
