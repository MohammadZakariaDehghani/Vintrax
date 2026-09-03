import Link from 'next/link';
import { ArrowRight, Gavel, ShieldCheck, Truck } from 'lucide-react';
import type { AuctionSummary, Paginated, VehicleSearchResponse } from '@atlas/shared';
import { serverFetch } from '@/lib/api-client';
import { formatPrice } from '@/lib/utils';
import { Button, Card, CardContent } from '@/components/ui';
import { VehicleCard } from '@/components/vehicle-card';
import { HomeSearch } from '@/components/home-search';
import { getServerDictionary } from '@/i18n/server';

const QUICK_LINKS = [
  { key: 'quickSuvs', query: 'bodyType=SUV' },
  { key: 'quickTrucks', query: 'bodyType=TRUCK' },
  { key: 'quickElectric', query: 'fuelType=ELECTRIC' },
  { key: 'quickUnder', query: 'maxPrice=30000' },
  { key: 'quickInspected', query: 'inspectedOnly=true' },
] as const;

const VALUE_PROPS = [
  { icon: ShieldCheck, title: 'inspectionsTitle', body: 'inspectionsBody' },
  { icon: Gavel, title: 'auctionsTitle', body: 'auctionsBody' },
  { icon: Truck, title: 'sellersTitle', body: 'sellersBody' },
] as const;

export default async function HomePage() {
  // Rendered on the server so the first paint carries real inventory, which
  // matters for search engines on a marketplace.
  const t = await getServerDictionary();
  const [featured, auctions] = await Promise.all([
    serverFetch<VehicleSearchResponse>('/vehicles?sort=NEWEST&pageSize=8'),
    serverFetch<Paginated<AuctionSummary>>('/auctions?status=LIVE&sort=ENDING_SOON&pageSize=3'),
  ]);

  return (
    <>
      <section className="border-b-4 border-accent bg-gradient-to-br from-primary via-primary to-[hsl(222_70%_15%)]">
        <div className="container py-16 md:py-24">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-bold tracking-tight text-primary-foreground md:text-5xl">
              {t.home.heroTitle}
            </h1>
            <p className="mt-4 text-lg text-primary-foreground/85">
              {t.home.heroBody}
            </p>

            <HomeSearch />

            <div className="mt-6 flex flex-wrap gap-2">
              {QUICK_LINKS.map((link) => (
                <Link
                  key={link.key}
                  href={`/vehicles?${link.query}`}
                  className="rounded-full bg-white/15 px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-white/25"
                >
                  {t.home[link.key]}
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
              <h2 className="text-2xl font-bold tracking-tight">{t.home.closingSoon}</h2>
              <p className="text-sm text-muted-foreground">{t.home.closingSoonBody}</p>
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
            <h2 className="text-2xl font-bold tracking-tight">{t.home.recentlyListed}</h2>
            <p className="text-sm text-muted-foreground">
              {featured ? `${featured.total} ${t.home.available}` : t.home.freshInventory}
            </p>
          </div>
          <Link href="/vehicles" className="text-sm font-medium text-primary hover:underline">
            {t.home.browseAll} <ArrowRight className="inline h-3.5 w-3.5" aria-hidden />
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
              {t.home.inventoryLoading}
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
              <h3 className="font-semibold">{t.home[prop.title]}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t.home[prop.body]}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container py-14">
        <Card className="overflow-hidden">
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <h2 className="text-2xl font-bold tracking-tight">{t.home.sellingTitle}</h2>
            <p className="max-w-xl text-muted-foreground">
              {t.home.sellingBody}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/register?role=SELLER">
                <Button size="lg">{t.home.sellCta}</Button>
              </Link>
              <Link href="/register?role=DEALER">
                <Button size="lg" variant="outline">
                  {t.home.dealerCta}
                </Button>
              </Link>
            </div>
            {featured?.facets.priceRange ? (
              <p className="text-xs text-muted-foreground">
                {t.home.priceRange} {formatPrice(featured.facets.priceRange.min)}{' '}
                {t.home.priceRangeTo} {formatPrice(featured.facets.priceRange.max)}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
