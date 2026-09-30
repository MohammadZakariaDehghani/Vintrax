import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChevronLeft, CircleCheck } from 'lucide-react';
import type { Paginated, VehicleDetail, VehicleSummary } from '@vintrax/shared';
import { serverFetch } from '@/lib/api-client';
import { formatEnum, formatKm, formatLocation, formatPrice } from '@/lib/utils';
import { IMAGE_SIZES, OptimizedImage } from '@/components/optimized-image';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ kind?: string; c?: string }>;
}

export const metadata: Metadata = {
  title: 'Request sent',
  // A confirmation belongs to one visitor's session, not to the index.
  robots: { index: false, follow: false },
};

const MAX_SUGGESTIONS = 6;

/**
 * Cars like the one just enquired about: the same make and model first, then
 * the same body type, never the car itself or a duplicate.
 */
async function similarVehicles(vehicle: VehicleDetail): Promise<VehicleSummary[]> {
  const queries = [
    `make=${encodeURIComponent(vehicle.make)}&model=${encodeURIComponent(vehicle.model)}`,
    `make=${encodeURIComponent(vehicle.make)}`,
    `bodyType=${vehicle.bodyType}`,
  ];
  const found = new Map<string, VehicleSummary>();
  for (const query of queries) {
    if (found.size >= MAX_SUGGESTIONS) break;
    const page = await serverFetch<Paginated<VehicleSummary>>(
      `/vehicles?${query}&sort=NEWEST&pageSize=12`,
    );
    for (const item of page?.items ?? []) {
      if (item.id !== vehicle.id && item.status === 'ACTIVE' && found.size < MAX_SUGGESTIONS) {
        found.set(item.id, item);
      }
    }
  }
  return [...found.values()];
}

/**
 * Where a buyer lands after sending a seller a message or a finance
 * application: confirmation of what was sent, and more cars like it with a
 * way to contact their sellers too.
 */
export default async function RequestSentPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { kind, c: conversationId } = await searchParams;
  const vehicle = await serverFetch<VehicleDetail>(`/vehicles/${slug}`);
  if (!vehicle) notFound();

  const suggestions = await similarVehicles(vehicle);
  const isFinance = kind === 'finance';
  const sellerName = vehicle.seller.dealer?.name ?? 'the seller';
  const conversationLink =
    conversationId && /^[0-9a-f-]{36}$/i.test(conversationId)
      ? `/dashboard/messages/${conversationId}`
      : null;

  return (
    <div className="container max-w-4xl py-8">
      <Link
        href={`/vehicles/${vehicle.slug}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Back to the {vehicle.make} {vehicle.model}
      </Link>

      <div
        role="status"
        className="mt-6 flex items-start gap-3 rounded-md border border-success/60 bg-success/10 px-4 py-3"
      >
        <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
        <div className="text-sm font-medium sm:text-base">
          <p>
            {isFinance ? 'Finance application sent to ' : 'Message sent to '}
            {isFinance ? sellerName : `the seller of the ${vehicle.title}`}
            {isFinance ? ` for the ${vehicle.title}` : ''} -{' '}
            <span className="tabular">{formatPrice(vehicle.priceCad)}</span>. You should hear from
            them soon.
          </p>
          {conversationLink ? (
            <Link
              href={conversationLink}
              className="mt-1 inline-block text-sm font-semibold text-primary hover:underline"
            >
              View your conversation
            </Link>
          ) : null}
        </div>
      </div>

      {suggestions.length > 0 ? (
        <section className="mt-10" aria-labelledby="more-sellers">
          <h1 id="more-sellers" className="text-2xl font-bold tracking-tight sm:text-3xl">
            Contact more sellers
          </h1>
          <p className="text-xl font-semibold tracking-tight sm:text-2xl">
            We’ve found other vehicles you might be interested in!
          </p>

          <ul className="mt-6 space-y-6">
            {suggestions.map((item) => (
              <li key={item.id} className="flex flex-col gap-4 sm:flex-row">
                <Link
                  href={`/vehicles/${item.slug}`}
                  className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-lg bg-secondary sm:w-64"
                  tabIndex={-1}
                  aria-hidden
                >
                  {item.primaryImageUrl ? (
                    <OptimizedImage
                      image={item.primaryImage}
                      src={item.primaryImageUrl}
                      alt=""
                      sizes={IMAGE_SIZES.row}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </Link>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold">
                    <Link href={`/vehicles/${item.slug}`} className="hover:text-primary">
                      {item.title}
                    </Link>
                  </h2>
                  <p className="tabular text-2xl font-bold">{formatPrice(item.priceCad)}</p>
                  <dl className="mt-1 space-y-0.5 text-sm">
                    <div>
                      <dt className="inline">Mileage: </dt>
                      <dd className="inline tabular">{formatKm(item.mileageKm)}</dd>
                    </div>
                    <div>
                      <dt className="inline">Condition: </dt>
                      <dd className="inline">{formatEnum(item.condition)}</dd>
                    </div>
                    <div>
                      <dt className="inline">City: </dt>
                      <dd className="inline">{formatLocation(item.city, item.province)}</dd>
                    </div>
                  </dl>
                  <Link
                    href={`/vehicles/${item.slug}`}
                    className="mt-3 inline-flex items-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Contact Seller
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="mt-10 text-sm text-muted-foreground">
          <Link href="/vehicles" className="font-semibold text-primary hover:underline">
            Browse more vehicles
          </Link>
        </p>
      )}
    </div>
  );
}
