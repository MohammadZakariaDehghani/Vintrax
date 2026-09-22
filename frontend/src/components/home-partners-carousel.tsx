import type { Partner } from '@vintrax/shared';
import { ItemCarousel } from '@/components/item-carousel';

/**
 * The home page's "Our Partners" row (issue #67) — the same `ItemCarousel`
 * Popular Makes and the blog row use, showing 4 logos at a time on desktop.
 * Only `enabled` partners are drawn; the admin page is what sees every row,
 * enabled or not, to manage them.
 */
export function HomePartnersCarousel({ partners }: { partners: Partner[] }) {
  const active = partners.filter((partner) => partner.enabled);
  if (active.length === 0) return null;

  return (
    <section className="container py-12">
      <h2 className="mb-3 text-xl font-bold tracking-tight">Our partners</h2>
      <ItemCarousel
        items={active.map((partner) => ({
          key: partner.id,
          // A partner's logo is an arbitrary aspect ratio brand mark, so the
          // tile preserves it in full (`object-contain`) rather than cropping
          // to fill — the same reasoning make-logos' own admin preview uses.
          content: (
            <div className="grid aspect-[3/2] w-full place-items-center rounded-md border border-border bg-white p-4">
              {/* Same-origin uploads; next/image optimisation adds a hop without a benefit. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={partner.logoUrl}
                alt={partner.alt ?? partner.name}
                loading="lazy"
                className="h-full w-full object-contain"
              />
            </div>
          ),
        }))}
        ariaLabel="Our partners"
        itemClassName="w-1/2 sm:w-1/3 lg:w-1/4"
      />
    </section>
  );
}
