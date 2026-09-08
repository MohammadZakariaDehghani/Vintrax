import Link from 'next/link';
import { ArrowRight, Gavel, ShieldCheck, Truck } from 'lucide-react';
import type { AuctionSummary, Paginated, VehicleSearchResponse } from '@atlas/shared';
import { serverFetch } from '@/lib/api-client';
import { formatEnum, formatPrice } from '@/lib/utils';
import { Button, Card, CardContent } from '@/components/ui';
import { VehicleRow } from '@/components/vehicle-row';
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
    serverFetch<VehicleSearchResponse>('/vehicles?sort=NEWEST&pageSize=10'),
    serverFetch<Paginated<AuctionSummary>>('/auctions?status=LIVE&sort=ENDING_SOON&pageSize=3'),
  ]);

  return (
    <>
      {/* A hero is a toll booth between a visitor and the inventory. This one
          is sized to clear the fold on a laptop with listings already
          visible, and the search below it is the point of the section. */}
      <section className="border-b-4 border-accent bg-gradient-to-br from-primary via-primary to-[hsl(222_70%_15%)]">
        <div className="container py-8 md:py-12">
          <h1 className="text-2xl font-bold tracking-tight text-primary-foreground md:text-3xl">
            {t.home.heroTitle}
          </h1>
          <p className="mt-1.5 text-primary-foreground/80">{t.home.heroBody}</p>

          <HomeSearch makes={featured?.facets.makes.map((entry) => entry.value) ?? []} />

          <div className="mt-4 flex flex-wrap gap-2">
            {QUICK_LINKS.map((link) => (
              <Link
                key={link.key}
                href={`/vehicles?${link.query}`}
                className="rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-white/25"
              >
                {t.home[link.key]}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Body type is the first cut most buyers make, and the facet counts
          turn it from decoration into a real signal of what is in stock. */}
      {featured && featured.facets.bodyTypes.length > 0 ? (
        <section className="border-b border-border bg-card">
          <div className="container py-5">
            <h2 className="sr-only">{t.home.shopByType}</h2>
            <ul className="flex flex-wrap gap-2">
              {featured.facets.bodyTypes.map((entry) => (
                <li key={entry.value}>
                  <Link
                    href={`/vehicles?bodyType=${entry.value}`}
                    className="flex items-baseline gap-2 rounded-md border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-secondary"
                  >
                    {formatEnum(entry.value)}
                    <span className="tabular text-xs text-muted-foreground">{entry.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

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

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {auctions.items.map((auction) =>
              auction.vehicle ? (
                <VehicleRow key={auction.id} vehicle={auction.vehicle} />
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
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {featured.items.map((vehicle) => (
              <VehicleRow key={vehicle.id} vehicle={vehicle} />
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
