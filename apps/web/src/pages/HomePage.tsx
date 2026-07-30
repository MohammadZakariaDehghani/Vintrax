import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ListingSearchResponse } from '@atlas/shared';
import { api } from '../lib/api-client';
import { ListingCard, ListingCardSkeleton } from '../components/ListingCard';
import { ErrorAlert } from '../components/ui';

const QUICK_SEARCHES = [
  { label: 'SUVs', query: 'bodyType=SUV' },
  { label: 'Trucks', query: 'bodyType=TRUCK' },
  { label: 'Electric', query: 'fuelType=ELECTRIC' },
  { label: 'Under $30,000', query: 'maxPrice=30000' },
  { label: 'Private sellers', query: 'sellerType=PRIVATE_SELLER' },
];

export function HomePage() {
  const [term, setTerm] = useState('');
  const navigate = useNavigate();

  const { data, isPending, error } = useQuery({
    queryKey: ['listings', 'featured'],
    queryFn: () =>
      api.get<ListingSearchResponse>('/listings?sort=NEWEST&pageSize=8'),
  });

  return (
    <>
      <section className="hero">
        <h1>Find your next vehicle, without the pressure</h1>
        <p>
          Browse listings from dealerships and private sellers across Canada. Message sellers
          directly, save the vehicles you like, and take the time you need.
        </p>

        <form
          className="hero-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = term.trim();
            navigate(trimmed ? `/listings?q=${encodeURIComponent(trimmed)}` : '/listings');
          }}
        >
          <label htmlFor="hero-search-input" className="visually-hidden">
            Search vehicles by make, model or keyword
          </label>
          <input
            id="hero-search-input"
            type="search"
            placeholder="Try “RAV4”, “electric SUV” or “4x4”"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
          <button type="submit" className="btn">
            Search
          </button>
        </form>

        <div className="quick-links">
          {QUICK_SEARCHES.map((quick) => (
            <Link key={quick.label} className="quick-link" to={`/listings?${quick.query}`}>
              {quick.label}
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="section-header">
          <h2>Recently listed</h2>
          <Link to="/listings">Browse all listings →</Link>
        </div>

        <ErrorAlert error={error} />

        <div className="listing-grid">
          {isPending
            ? Array.from({ length: 8 }, (_, index) => <ListingCardSkeleton key={index} />)
            : data?.items.map((listing) => <ListingCard key={listing.id} listing={listing} />)}
        </div>
      </section>
    </>
  );
}
