import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationDetail, ListingDetail } from '@atlas/shared';
import { ApiError, api } from '../lib/api-client';
import { useAuth } from '../auth/auth-context';
import { Badge, ErrorAlert, ListingImage, Spinner } from '../components/ui';
import {
  formatDate,
  formatEnum,
  formatKm,
  formatLocation,
  formatPrice,
  formatProvince,
} from '../lib/format';

function SellerPanel({ listing }: { listing: ListingDetail }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState(
    `Hi, I'm interested in your ${listing.year} ${listing.make} ${listing.model}. Is it still available?`,
  );

  const isOwnListing = user?.id === listing.seller.id;

  const sendEnquiry = useMutation({
    mutationFn: (body: string) =>
      api.post<ConversationDetail>('/conversations', { listingId: listing.id, body }),
    onSuccess: (conversation) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
      navigate(`/messages/${conversation.id}`);
    },
  });

  const toggleFavourite = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) await api.put(`/listings/${listing.id}/favourite`);
      else await api.delete(`/listings/${listing.id}/favourite`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['listing', listing.id] });
      void queryClient.invalidateQueries({ queryKey: ['favourites'] });
    },
  });

  return (
    <div className="panel seller-card">
      <div className="price-large">{formatPrice(listing.priceCad)}</div>
      <p className="muted" style={{ marginTop: '0.25rem' }}>
        {formatKm(listing.mileageKm)} · {formatEnum(listing.condition)}
      </p>

      <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '1rem 0' }} />

      <h3 style={{ fontSize: '1rem' }}>
        {listing.seller.dealership?.name ?? listing.seller.displayName}
      </h3>
      <p className="muted" style={{ fontSize: '0.88rem' }}>
        {listing.seller.dealership ? 'Dealership' : 'Private seller'}
        {listing.seller.city && listing.seller.province
          ? ` · ${formatLocation(listing.seller.city, listing.seller.province)}`
          : null}
        <br />
        Member since {formatDate(listing.seller.memberSince)}
      </p>
      {listing.seller.dealership?.verified ? <Badge tone="success">✓ Verified dealer</Badge> : null}

      <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '1rem 0' }} />

      {isOwnListing ? (
        <>
          <p className="muted" style={{ fontSize: '0.9rem' }}>
            This is your listing.
          </p>
          <Link to={`/dashboard/listings/${listing.id}`} className="btn btn-block">
            Edit listing
          </Link>
        </>
      ) : !user ? (
        <>
          <p style={{ fontSize: '0.92rem' }}>Sign in to message this seller and save the listing.</p>
          <Link to="/login" className="btn btn-block">
            Sign in to message
          </Link>
        </>
      ) : listing.status !== 'ACTIVE' ? (
        <p className="muted">This listing is no longer accepting enquiries.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            sendEnquiry.mutate(message);
          }}
        >
          <div className="field">
            <label htmlFor="enquiry">Message the seller</label>
            <textarea
              id="enquiry"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={4000}
              required
              style={{ minHeight: 110 }}
            />
          </div>

          <ErrorAlert error={sendEnquiry.error} />

          <button
            type="submit"
            className="btn btn-block"
            disabled={sendEnquiry.isPending || !message.trim()}
          >
            {sendEnquiry.isPending ? 'Sending…' : 'Send message'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            style={{ marginTop: '0.6rem' }}
            onClick={() => toggleFavourite.mutate(!listing.isFavourited)}
            disabled={toggleFavourite.isPending}
          >
            {listing.isFavourited ? '♥ Saved' : '♡ Save this vehicle'}
          </button>
        </form>
      )}
    </div>
  );
}

export function ListingDetailPage() {
  const { id = '' } = useParams();
  const [activeImage, setActiveImage] = useState(0);

  const { data: listing, isPending, error } = useQuery({
    queryKey: ['listing', id],
    queryFn: () => api.get<ListingDetail>(`/listings/${id}`),
  });

  if (isPending) return <Spinner label="Loading listing" />;

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="panel">
        <h1>{notFound ? 'Listing not found' : 'Could not load this listing'}</h1>
        <p className="muted">
          {notFound
            ? 'This listing may have been removed, sold, or is not yet published.'
            : 'Please try again in a moment.'}
        </p>
        <Link to="/listings" className="btn btn-secondary">
          Back to browse
        </Link>
      </div>
    );
  }

  const images = listing.images;
  const current = images[Math.min(activeImage, images.length - 1)];

  return (
    <>
      <p style={{ marginBottom: '1rem' }}>
        <Link to="/listings">← Back to results</Link>
      </p>

      <div className="detail-layout">
        <div>
          <div className="panel" style={{ marginBottom: '1.5rem' }}>
            <div className="panel-header">
              <div>
                <h1 style={{ marginBottom: '0.35rem' }}>{listing.title}</h1>
                <p className="muted" style={{ margin: 0 }}>
                  {formatLocation(listing.city, listing.province)} ·{' '}
                  {listing.viewCount.toLocaleString('en-CA')} views
                </p>
              </div>
              {listing.status !== 'ACTIVE' ? (
                <Badge tone={listing.status === 'SOLD' ? 'accent' : 'neutral'}>
                  {formatEnum(listing.status)}
                </Badge>
              ) : null}
            </div>

            <div className="gallery-main">
              <ListingImage src={current?.url ?? null} alt={current?.alt ?? listing.title} />
            </div>

            {images.length > 1 ? (
              <div className="gallery-thumbs">
                {images.map((image, index) => (
                  <button
                    key={image.id}
                    type="button"
                    className="gallery-thumb"
                    aria-current={index === activeImage}
                    aria-label={`View photo ${index + 1} of ${images.length}`}
                    onClick={() => setActiveImage(index)}
                  >
                    <img src={image.url} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="panel" style={{ marginBottom: '1.5rem' }}>
            <h2>Vehicle details</h2>
            <dl className="spec-grid">
              <div>
                <dt>Year</dt>
                <dd>{listing.year}</dd>
              </div>
              <div>
                <dt>Make</dt>
                <dd>{listing.make}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>
                  {listing.model}
                  {listing.trim ? ` ${listing.trim}` : ''}
                </dd>
              </div>
              <div>
                <dt>Mileage</dt>
                <dd>{formatKm(listing.mileageKm)}</dd>
              </div>
              <div>
                <dt>Body type</dt>
                <dd>{formatEnum(listing.bodyType)}</dd>
              </div>
              <div>
                <dt>Transmission</dt>
                <dd>{formatEnum(listing.transmission)}</dd>
              </div>
              <div>
                <dt>Fuel type</dt>
                <dd>{formatEnum(listing.fuelType)}</dd>
              </div>
              <div>
                <dt>Drivetrain</dt>
                <dd>{formatEnum(listing.drivetrain)}</dd>
              </div>
              <div>
                <dt>Condition</dt>
                <dd>{formatEnum(listing.condition)}</dd>
              </div>
              {listing.exteriorColour ? (
                <div>
                  <dt>Exterior colour</dt>
                  <dd>{listing.exteriorColour}</dd>
                </div>
              ) : null}
              <div>
                <dt>Province</dt>
                <dd>{formatProvince(listing.province)}</dd>
              </div>
              {listing.vin ? (
                <div>
                  <dt>VIN</dt>
                  <dd style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}>
                    {listing.vin}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className="panel">
            <h2>Description</h2>
            <p className="description-body">{listing.description}</p>
          </div>
        </div>

        <SellerPanel listing={listing} />
      </div>
    </>
  );
}
