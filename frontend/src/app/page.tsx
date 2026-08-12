import Link from 'next/link';
import { ArrowRight, Gavel, ShieldCheck, Truck } from 'lucide-react';
import type { AuctionSummary, Paginated, VehicleSearchResponse } from '@atlas/shared';
import { serverFetch } from '@/lib/api-client';
import { formatPrice } from '@/lib/utils';
import { Button, Card, CardContent } from '@/components/ui';
import { VehicleCard } from '@/components/vehicle-card';
import { HomeSearch } from '@/components/home-search';

const QUICK_LINKS = [
  { label: 'SUVs', query: 'bodyType=SUV' },
  { label: 'Trucks', query: 'bodyType=TRUCK' },
  { label: 'Electric', query: 'fuelType=ELECTRIC' },
  { label: 'Under $30,000', query: 'maxPrice=30000' },
  { label: 'Inspected', query: 'inspectedOnly=true' },
];

const VALUE_PROPS = [
  {
    icon: ShieldCheck,
    title: 'Independent inspections',
    body: 'Condition reports graded section by section, with structural damage disclosed up front.',
  },
  {
    icon: Gavel,
    title: 'Transparent auctions',
    body: 'Live bidding with anti-snipe extensions, so a lot cannot be won in the final seconds.',
  },
  {
    icon: Truck,
    title: 'Dealers and private sellers',
    body: 'Verified dealership inventory alongside private listings, in one searchable marketplace.',
  },
];

export default async function HomePage() {
  // Rendered on the server so the first paint carries real inventory, which
  // matters for search engines on a marketplace.
  const [featured, auctions] = await Promise.all([
    serverFetch<VehicleSearchResponse>('/vehicles?sort=NEWEST&pageSize=8'),
    serverFetch<Paginated<AuctionSummary>>('/auctions?status=LIVE&sort=ENDING_SOON&pageSize=3'),
  ]);

  return (
    <>
      <section className="border-b border-border bg-gradient-to-br from-primary via-primary to-accent">
        <div className="container py-16 md:py-24">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-bold tracking-tight text-primary-foreground md:text-5xl">
              Find your next vehicle, without the pressure
            </h1>
            <p className="mt-4 text-lg text-primary-foreground/85">
              Browse dealer inventory and private listings across Canada, bid in live auctions, and
              buy with an independent inspection report in hand.
            </p>

            <HomeSearch />

            <div className="mt-6 flex flex-wrap gap-2">
              {QUICK_LINKS.map((link) => (
                <Link
                  key={link.label}
                  href={`/vehicles?${link.query}`}
                  className="rounded-full bg-white/15 px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-white/25"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {auctions && auctions.items.length > 0 ? (
        <section className="container py-12">
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Closing soon</h2>
              <p className="text-sm text-muted-foreground">Live auctions accepting bids now.</p>
            </div>
            <Link href="/auctions" className="text-sm font-medium text-primary hover:underline">
              All auctions <ArrowRight className="inline h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {auctions.items.map((auction) =>
              auction.vehicle ? (
                <VehicleCard key={auction.id} vehicle={auction.vehicle} />
              ) : null,
            )}
          </div>
        </section>
      ) : null}

      <section className="container py-12">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Recently listed</h2>
            <p className="text-sm text-muted-foreground">
              {featured ? `${featured.total} vehicles available` : 'Fresh inventory'}
            </p>
          </div>
          <Link href="/vehicles" className="text-sm font-medium text-primary hover:underline">
            Browse all <ArrowRight className="inline h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>

        {featured && featured.items.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featured.items.map((vehicle) => (
              <VehicleCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Inventory is loading. If this persists, the API may not be running.
            </CardContent>
          </Card>
        )}
      </section>

      <section className="border-t border-border bg-card py-14">
        <div className="container grid gap-8 md:grid-cols-3">
          {VALUE_PROPS.map((prop) => (
            <div key={prop.title}>
              <div className="mb-3 grid h-11 w-11 place-items-center rounded-lg bg-primary/10 text-primary">
                <prop.icon className="h-5 w-5" aria-hidden />
              </div>
              <h3 className="font-semibold">{prop.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{prop.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container py-14">
        <Card className="overflow-hidden">
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <h2 className="text-2xl font-bold tracking-tight">Selling a vehicle?</h2>
            <p className="max-w-xl text-muted-foreground">
              List it at a fixed price or run it through auction. Dealers get inventory tools,
              analytics and lead management; private sellers get a guided listing flow.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/register?role=SELLER">
                <Button size="lg">Sell your vehicle</Button>
              </Link>
              <Link href="/register?role=DEALER">
                <Button size="lg" variant="outline">
                  Register as a dealer
                </Button>
              </Link>
            </div>
            {featured?.facets.priceRange ? (
              <p className="text-xs text-muted-foreground">
                Current inventory ranges from {formatPrice(featured.facets.priceRange.min)} to{' '}
                {formatPrice(featured.facets.priceRange.max)}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
