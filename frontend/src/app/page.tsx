import Link from 'next/link';
import { ArrowRight, Calculator, Gauge, Gavel, ShieldCheck, Truck } from 'lucide-react';
import type {
  ArticleSummary,
  AuctionSummary,
  BodyTypeImage,
  HomeFeature,
  HomeHero as HomeHeroContent,
  MakeLogo,
  Paginated,
  Partner,
  PromoTile,
  VehicleSearchResponse,
} from '@vintrax/shared';
import { serverFetch } from '@/lib/api-client';
import { formatPrice } from '@/lib/utils';
import { Button, Card, CardContent } from '@/components/ui';
import { VehicleRow } from '@/components/vehicle-row';
import { BrandLogo } from '@/components/brand-logo';
import { HomeSearch } from '@/components/home-search';
import { HomeMastheadSlider } from '@/components/home-masthead-slider';
import { HomeHero } from '@/components/home-hero';
import { SECTION_REVEAL, revealProps } from '@/components/media/media-style';
import { HomeBlogCarousel } from '@/components/home-blog-carousel';
import { HomePartnersCarousel } from '@/components/home-partners-carousel';
import { HomeFeatures } from '@/components/home-features';
import { PromoTiles } from '@/components/promo-tiles';
import { ContinueSearchCard } from '@/components/continue-search-card';
import { ItemCarousel } from '@/components/item-carousel';
import { buildBodyTypeShortcuts } from '@/lib/body-type-shortcuts';
import { buildPopularMakes } from '@/lib/popular-makes';
import { getServerDictionary } from '@/i18n/server';

/** How many recent posts the banner slideshow and the blog carousel show. */
const BLOG_CAROUSEL_SIZE = 5;

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
  const [
    featured,
    auctions,
    bodyTypeImages,
    makeLogos,
    blogPosts,
    partners,
    homeFeatures,
    promoTiles,
    hero,
  ] = await Promise.all([
    serverFetch<VehicleSearchResponse>('/vehicles?sort=NEWEST&pageSize=60'),
    serverFetch<Paginated<AuctionSummary>>('/auctions?status=LIVE&sort=ENDING_SOON&pageSize=3'),
    serverFetch<BodyTypeImage[]>('/admin/body-type-images'),
    serverFetch<MakeLogo[]>('/admin/make-logos'),
    serverFetch<Paginated<ArticleSummary>>(`/articles?pageSize=${BLOG_CAROUSEL_SIZE}`),
    serverFetch<Partner[]>('/admin/partners'),
    serverFetch<HomeFeature[]>('/home-features'),
    serverFetch<PromoTile[]>('/promo-tiles'),
    serverFetch<HomeHeroContent | null>('/home-hero'),
  ]);

  const recent = featured?.items.slice(0, 10) ?? [];
  // Every post has a photograph; the filter only keeps the banner honest if
  // one ever arrives without.
  const mastheadPosts = (blogPosts?.items ?? []).filter((post) => post.heroImageUrl);
  const bodyTypeShortcuts = buildBodyTypeShortcuts({
    curated: bodyTypeImages ?? [],
    counts: featured?.facets.bodyTypes ?? [],
  });
  const popularMakes = buildPopularMakes({
    curated: makeLogos ?? [],
    counts: featured?.facets.makes ?? [],
  });

  return (
    <>
      {/* The band is a backdrop, not a destination. The search card overlaps
          its lower edge so the first thing on the page is a control rather
          than a picture, and the band's height is set by its content instead
          of by an arbitrary hero size.

          When an editor has published something the band is a slideshow of
          the newest posts, up to five; otherwise it is the plain gradient and
          the standing proposition. The fallback is not a placeholder — a marketplace whose
          front page goes blank because nobody wrote this week is worse than
          one that never had a masthead. */}
      <section className="relative">
        {hero ? (
          // An administrator's hero, while it is switched on, takes the top of
          // the page; the newest posts still lead the carousel just below.
          <HomeHero hero={hero} className="pb-28" />
        ) : mastheadPosts.length > 0 ? (
          // The padding lives inside each slide so the photograph runs
          // behind the search card that overlaps it, as the gradient does.
          <HomeMastheadSlider articles={mastheadPosts} className="pb-28" />
        ) : (
          // Red into carbon, not red into navy. The old end-stop was a deep
          // blue, which sat far enough from a green brand to read as depth;
          // under a red one it reads as a second colour. Carbon is the
          // masthead's own value, so the band resolves into the bar above it.
          <div className="bg-gradient-to-br from-hero via-hero to-[hsl(0_12%_12%)] pb-28">
            <div className="container pt-10 md:pt-12">
              <h1 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight text-hero-foreground md:text-4xl">
                {t.home.heroTitle}
              </h1>
              <p className="mt-2 max-w-xl text-hero-foreground/80">{t.home.heroBody}</p>
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

      {/* Moved up from the bottom of the page (issue #67) — a carousel of
          recent posts belongs beside the other "what's happening right now"
          content near the top, not after everything else. */}
      <HomeBlogCarousel posts={blogPosts?.items ?? []} />

      <ContinueSearchCard />

      {/* Administrator-made photo boxes, each linking somewhere. */}
      <PromoTiles tiles={promoTiles ?? []} />

      {/* Makes in stock, each under its own mark. The count is the point of
          difference from the site this follows: a marque here is a promise
          that Vintrax has that many of them right now, not a brand billboard.
          A carousel showing 4 at a time (issue #67), not a fixed grid — the
          full set (`buildPopularMakes`'s cap, currently 15) is always in the
          DOM, reachable by scrolling rather than cut down to what fits. */}
      {popularMakes.length > 0 ? (
        <section className="container pt-10" {...revealProps(SECTION_REVEAL)}>
          <h2 className="mb-3 text-xl font-bold tracking-tight">{t.home.popularMakes}</h2>
          <ItemCarousel
            items={popularMakes.map((entry) => ({
              key: entry.make,
              content: (
                // No card around the make: the logo itself is the icon, drawn
                // larger, with the name and count under it.
                <Link
                  href={`/vehicles?make=${encodeURIComponent(entry.make)}`}
                  className="group flex h-full flex-col items-center justify-center gap-2 rounded-md px-3 py-4 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <BrandLogo
                    make={entry.make}
                    logoUrl={entry.logoUrl}
                    className="h-12 w-12 text-sm text-foreground/85 transition-transform duration-200 group-hover:scale-110"
                  />
                  <span className="text-sm font-semibold leading-tight group-hover:text-primary">
                    {entry.make}
                  </span>
                  <span className="tabular text-xs text-muted-foreground">
                    {entry.count} {entry.count === 1 ? t.home.makeOne : t.home.makeOther}
                  </span>
                </Link>
              ),
            }))}
            ariaLabel={t.home.popularMakes}
            itemClassName="w-1/2 sm:w-1/3 lg:w-1/4"
          />
        </section>
      ) : null}

      {/* The two calculators, after CarGurus' pair: what a visitor's car is
          worth, and how much car they can afford. */}
      <section className="container pt-10">
        <h2 className="mb-3 text-xl font-bold tracking-tight" {...revealProps(SECTION_REVEAL)}>
          {t.home.toolsTitle}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {[
            {
              href: '/tools/car-value',
              icon: Gauge,
              title: t.home.carValueTitle,
              body: t.home.carValueBody,
              cta: t.home.carValueCta,
            },
            {
              href: '/tools/budget',
              icon: Calculator,
              title: t.home.budgetTitle,
              body: t.home.budgetBody,
              cta: t.home.budgetCta,
            },
          ].map((tool, index) => (
            <Link
              key={tool.href}
              href={tool.href}
              {...revealProps(SECTION_REVEAL, { index })}
              className="group flex gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-secondary/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <tool.icon className="h-6 w-6" aria-hidden />
              </span>
              <span className="flex flex-col gap-1">
                <span className="font-semibold">{tool.title}</span>
                <span className="text-sm text-muted-foreground">{tool.body}</span>
                <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary group-hover:underline">
                  {tool.cta} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {auctions && auctions.items.length > 0 ? (
        <section className="container py-12" {...revealProps(SECTION_REVEAL)}>
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
              auction.vehicle ? <VehicleRow key={auction.id} vehicle={auction.vehicle} /> : null,
            )}
          </div>
        </section>
      ) : null}

      <section className="container py-12" {...revealProps(SECTION_REVEAL)}>
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

      {/* Administrator-made feature blocks, stacked under the newest listings. */}
      <HomeFeatures features={homeFeatures ?? []} />

      <section className="border-t border-border bg-card py-14">
        <div className="container grid gap-8 md:grid-cols-3">
          {VALUE_PROPS.map((prop, index) => (
            <div key={prop.title} {...revealProps(SECTION_REVEAL, { index })}>
              <div className="mb-3 grid h-11 w-11 place-items-center rounded-lg bg-primary/10 text-primary">
                <prop.icon className="h-5 w-5" aria-hidden />
              </div>
              <h3 className="font-semibold">{t.home[prop.title]}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t.home[prop.body]}</p>
            </div>
          ))}
        </div>
      </section>

      <HomePartnersCarousel partners={partners ?? []} />

      <section className="container py-14" {...revealProps({ type: 'SCALE' })}>
        <Card className="overflow-hidden">
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <h2 className="text-2xl font-bold tracking-tight">{t.home.sellingTitle}</h2>
            <p className="max-w-xl text-muted-foreground">{t.home.sellingBody}</p>
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
