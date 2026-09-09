import Link from 'next/link';
import { ArrowRight, Gavel, ShieldCheck, Truck } from 'lucide-react';
import type {
  ArticleSummary,
  AuctionSummary,
  BodyTypeImage,
  Paginated,
  VehicleSearchResponse,
} from '@atlas/shared';
import { serverFetch } from '@/lib/api-client';
import { formatPrice } from '@/lib/utils';
import { Button, Card, CardContent } from '@/components/ui';
import { VehicleRow } from '@/components/vehicle-row';
import { BrandLogo } from '@/components/brand-logo';
import { HomeSearch } from '@/components/home-search';
import { HomeMasthead } from '@/components/home-masthead';
import { buildBodyTypeShortcuts } from '@/lib/body-type-shortcuts';
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
  // One wider page, two uses: the ten newest fill the list below, and the rest
  // are scanned for a photographed example of each body type. A second round
  // trip per body type would be nine more queries for nine thumbnails.
  const [featured, auctions, bodyTypeImages, masthead] = await Promise.all([
    serverFetch<VehicleSearchResponse>('/vehicles?sort=NEWEST&pageSize=60'),
    serverFetch<Paginated<AuctionSummary>>('/auctions?status=LIVE&sort=ENDING_SOON&pageSize=3'),
    serverFetch<BodyTypeImage[]>('/admin/body-type-images'),
    serverFetch<ArticleSummary | null>('/articles/masthead'),
  ]);

  const recent = featured?.items.slice(0, 10) ?? [];
  const bodyTypeShortcuts = buildBodyTypeShortcuts({
    curated: bodyTypeImages ?? [],
    vehicles: featured?.items ?? [],
    counts: featured?.facets.bodyTypes ?? [],
  });

  return (
    <>
      {/* The band is a backdrop, not a destination. The search card overlaps
          its lower edge so the first thing on the page is a control rather
          than a picture, and the band's height is set by its content instead
          of by an arbitrary hero size.

          When an editor has published something the band is that post's
          masthead; otherwise it is the plain gradient and the standing
          proposition. The fallback is not a placeholder — a marketplace whose
          front page goes blank because nobody wrote this week is worse than
          one that never had a masthead. */}
      <section className="relative">
        {masthead ? (
          // The padding lives inside the masthead so the photograph runs
          // behind the search card that overlaps it, as the gradient does.
          <HomeMasthead article={masthead} className="pb-28" />
        ) : (
          <div className="bg-gradient-to-br from-primary via-primary to-[hsl(222_70%_15%)] pb-28">
            <div className="container pt-10 md:pt-12">
              <h1 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight text-primary-foreground md:text-4xl">
                {t.home.heroTitle}
              </h1>
              <p className="mt-2 max-w-xl text-primary-foreground/80">{t.home.heroBody}</p>
            </div>
          </div>
        )}

        {/* Above the band, not behind it. The masthead is a positioned
            element, so a statically-positioned card would paint underneath it
            — which the plain gradient never revealed, because a background on
            an unpositioned div paints below everything either way. */}
        <div className="container relative z-10 -mt-24">
          <HomeSearch
            makes={featured?.facets.makes.map((entry) => entry.value) ?? []}
            bodyTypes={bodyTypeShortcuts}
          />

          <div className="mt-4 flex flex-wrap gap-2">
            {QUICK_LINKS.map((link) => (
              <Link
                key={link.key}
                href={`/vehicles?${link.query}`}
                className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-secondary"
              >
                {t.home[link.key]}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Makes in stock, each under its own mark. The count is the point of
          difference from the site this follows: a marque here is a promise
          that Atlas has that many of them right now, not a brand billboard. */}
      {featured && featured.facets.makes.length > 0 ? (
        <section className="container pt-10">
          <h2 className="mb-3 text-xl font-bold tracking-tight">{t.home.popularMakes}</h2>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {featured.facets.makes.slice(0, 12).map((entry) => (
              <li key={entry.value}>
                <Link
                  href={`/vehicles?make=${encodeURIComponent(entry.value)}`}
                  className="flex h-full flex-col items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-5 text-center transition-colors hover:border-primary/40 hover:bg-secondary"
                >
                  <BrandLogo make={entry.value} className="text-foreground/85" />
                  <span className="text-sm font-semibold leading-tight">{entry.value}</span>
                  <span className="tabular text-xs text-muted-foreground">
                    {entry.count} {entry.count === 1 ? t.home.makeOne : t.home.makeOther}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
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

        {recent.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {recent.map((vehicle) => (
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
