import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Globe, MapPin, Phone, ShieldCheck } from 'lucide-react';
import type { DealerDetail, Paginated, VehicleSummary } from '@vintrax/shared';
import { serverFetch } from '@/lib/api-client';
import { formatDate, formatLocation } from '@/lib/utils';
import { Badge, Card, CardContent, EmptyState } from '@/components/ui';
import { VehicleCard } from '@/components/vehicle-card';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const dealer = await serverFetch<DealerDetail>(`/dealers/${slug}`);
  if (!dealer) return { title: 'Dealership not found' };

  return {
    title: dealer.name,
    description:
      dealer.description?.slice(0, 160) ??
      `${dealer.name} — inventory on Vintrax, Canada's auto marketplace.`,
    alternates: { canonical: `/dealers/${dealer.slug}` },
  };
}

export default async function DealerPage({ params }: PageProps) {
  const { slug } = await params;

  const [dealer, inventory] = await Promise.all([
    serverFetch<DealerDetail>(`/dealers/${slug}`),
    serverFetch<Paginated<VehicleSummary>>(`/dealers/${slug}/inventory?page=1&pageSize=24`),
  ]);
  if (!dealer) notFound();

  const vehicles = inventory?.items ?? [];

  return (
    <div className="container py-8">
      <nav className="mb-4 text-sm" aria-label="Breadcrumb">
        <Link href="/vehicles" className="text-muted-foreground hover:text-foreground">
          ← Back to results
        </Link>
      </nav>

      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-6 pt-6">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{dealer.name}</h1>
              {dealer.verified ? (
                <Badge variant="success" className="gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  Verified dealer
                </Badge>
              ) : null}
            </div>

            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {dealer.city && dealer.province ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" aria-hidden />
                  {formatLocation(dealer.city, dealer.province)}
                </span>
              ) : null}
              {dealer.phone ? (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="h-4 w-4" aria-hidden />
                  {dealer.phone}
                </span>
              ) : null}
              {dealer.websiteUrl ? (
                <a
                  href={dealer.websiteUrl}
                  target="_blank"
                  rel="noreferrer nofollow"
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
                >
                  <Globe className="h-4 w-4" aria-hidden />
                  Website
                </a>
              ) : null}
            </p>

            {dealer.description ? (
              <p className="mt-4 max-w-2xl whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {dealer.description}
              </p>
            ) : null}
          </div>

          <dl className="flex flex-wrap gap-x-8 gap-y-4">
            <div>
              <dt className="text-sm text-muted-foreground">Listings</dt>
              <dd className="tabular text-2xl font-bold">{dealer.activeListingCount}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Sales</dt>
              <dd className="tabular text-2xl font-bold">{dealer.completedSaleCount}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">On Vintrax since</dt>
              <dd className="text-2xl font-bold">{formatDate(dealer.memberSince)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <h2 className="mb-4 mt-8 text-xl font-bold tracking-tight">
        Inventory
        {inventory ? (
          <span className="ml-2 text-base font-normal text-muted-foreground">
            {inventory.total} {inventory.total === 1 ? 'vehicle' : 'vehicles'}
          </span>
        ) : null}
      </h2>

      {vehicles.length > 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((vehicle) => (
            <VehicleCard key={vehicle.id} vehicle={vehicle} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            title="No vehicles listed right now"
            description="This dealership has nothing published at the moment. Check back soon."
          />
        </Card>
      )}
    </div>
  );
}
