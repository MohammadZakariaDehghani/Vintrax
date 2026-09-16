import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { AlertTriangle, ChevronRight, MapPin, ShieldCheck } from 'lucide-react';
import type { VehicleDetail } from '@vintrax/shared';
import { serverFetch } from '@/lib/api-client';
import { formatDate, formatEnum, formatKm, formatLocation, formatPrice } from '@/lib/utils';
import { vehicleFacts, vehicleSubtitle } from '@/lib/vehicle-facts';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { VehicleGallery } from '@/components/vehicle-gallery';
import { ContactSellerPanel } from '@/components/contact-seller-panel';
import { InspectionReport } from '@/components/inspection-report';
import { VehicleDocuments } from '@/components/vehicle-documents';
import { DescriptionBody } from '@/components/description-body';
import { VehicleHistory } from '@/components/vehicle-history';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const vehicle = await serverFetch<VehicleDetail>(`/vehicles/${slug}`);
  if (!vehicle) return { title: 'Vehicle not found' };

  return {
    title: vehicle.title,
    description: vehicle.description.slice(0, 160),
    openGraph: {
      title: vehicle.title,
      description: vehicle.description.slice(0, 160),
      images: vehicle.primaryImageUrl ? [vehicle.primaryImageUrl] : [],
    },
  };
}

export default async function VehicleDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const vehicle = await serverFetch<VehicleDetail>(`/vehicles/${slug}`);
  if (!vehicle) notFound();

  const facts = vehicleFacts(vehicle);

  const specs: Array<[string, string]> = [
    ['Year', String(vehicle.year)],
    ['Make', vehicle.make],
    ['Model', vehicle.trim ? `${vehicle.model} ${vehicle.trim}` : vehicle.model],
    ['Mileage', formatKm(vehicle.mileageKm)],
    ['Body type', formatEnum(vehicle.bodyType)],
    ['Transmission', formatEnum(vehicle.transmission)],
    ['Fuel type', formatEnum(vehicle.fuelType)],
    ['Drivetrain', formatEnum(vehicle.drivetrain)],
    ['Condition', formatEnum(vehicle.condition)],
    ...(vehicle.engine ? ([['Engine', vehicle.engine]] as Array<[string, string]>) : []),
    ...(vehicle.cylinders
      ? ([['Cylinders', String(vehicle.cylinders)]] as Array<[string, string]>)
      : []),
    ...(vehicle.seats ? ([['Seats', String(vehicle.seats)]] as Array<[string, string]>) : []),
    ...(vehicle.exteriorColour
      ? ([['Exterior', vehicle.exteriorColour]] as Array<[string, string]>)
      : []),
    ...(vehicle.interiorColour
      ? ([['Interior', vehicle.interiorColour]] as Array<[string, string]>)
      : []),
  ];

  return (
    <div className="container py-6">
      {/* The breadcrumb reads as the path taken to get here — buy, shape,
          province, car — rather than a single "back" link, so the two steps
          above this page are one click away instead of a browser gesture. */}
      <nav
        className="mb-5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
        aria-label="Breadcrumb"
      >
        <Link href="/vehicles" className="hover:text-foreground">
          Buy
        </Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link href={`/vehicles?bodyType=${vehicle.bodyType}`} className="hover:text-foreground">
          {formatEnum(vehicle.bodyType)}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link href={`/vehicles?province=${vehicle.province}`} className="hover:text-foreground">
          {vehicle.province}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <span className="text-foreground">{vehicle.title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          <VehicleGallery images={vehicle.images} title={vehicle.title} />

          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{vehicle.title}</h1>
              <div className="flex flex-wrap gap-2">
                {vehicle.hasInspection ? (
                  <Badge variant="success">
                    <ShieldCheck className="h-3 w-3" aria-hidden />
                    Inspected
                  </Badge>
                ) : null}
                {vehicle.status !== 'ACTIVE' ? (
                  <Badge variant={vehicle.status === 'SOLD' ? 'default' : 'warning'}>
                    {formatEnum(vehicle.status)}
                  </Badge>
                ) : null}
              </div>
            </div>

            <p className="mt-1.5 text-sm text-muted-foreground">{vehicleSubtitle(vehicle)}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {formatLocation(vehicle.city, vehicle.province)} ·{' '}
              <span className="tabular">{vehicle.viewCount.toLocaleString('en-CA')}</span> views
            </p>
          </div>

          {/* The figures a buyer looks for first, in one strip. Two of them can
              only come from the seller's own timeline, so those are marked:
              printing an unattributed "None reported" in this size would be
              Vintrax making a claim about a car it has not inspected. */}
          <div className="grid grid-cols-2 divide-border overflow-hidden rounded-lg border border-border sm:grid-cols-4 sm:divide-x">
            {facts.map((fact) => (
              <div
                key={fact.label}
                className="border-b border-border p-4 last:border-b-0 sm:border-b-0"
              >
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {fact.label}
                </p>
                <p
                  className={`mt-1 text-lg font-semibold ${
                    fact.adverse ? 'text-destructive' : 'text-foreground'
                  }`}
                >
                  {fact.adverse ? (
                    <AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden />
                  ) : null}
                  {fact.value}
                </p>
                {fact.fromSeller ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">Per the seller</p>
                ) : null}
              </div>
            ))}
          </div>

          <VehicleHistory
            events={vehicle.historyEvents}
            reportIssuedOn={vehicle.historyReportIssuedOn}
          />

          {vehicle.inspection ? <InspectionReport vehicleId={vehicle.id} /> : null}

          <Card>
            <CardHeader>
              <CardTitle>Vehicle details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {specs.map(([label, value]) => (
                  <div key={label} className="border-b border-border pb-2">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {label}
                    </dt>
                    <dd className="mt-0.5 font-medium">{value}</dd>
                  </div>
                ))}
              </dl>

              {vehicle.features.length > 0 ? (
                <div className="mt-6">
                  <h3 className="mb-2 text-sm font-semibold">Features</h3>
                  <div className="flex flex-wrap gap-2">
                    {vehicle.features.map((feature) => (
                      <Badge key={feature} variant="outline">
                        {feature}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Seller notes</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionBody description={vehicle.description} />
            </CardContent>
          </Card>

          <VehicleDocuments vehicleId={vehicle.id} documentCount={vehicle.documentCount} />
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
          <ContactSellerPanel vehicle={vehicle} />

          <Card>
            <CardContent className="pt-5 text-sm">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Seller</p>
              <p className="mt-2 font-semibold">
                {vehicle.seller.dealer?.name ?? vehicle.seller.displayName}
              </p>
              <p className="mt-1 text-muted-foreground">
                {vehicle.seller.dealer ? 'Dealership' : 'Private seller'}
                {vehicle.seller.city && vehicle.seller.province
                  ? ` · ${formatLocation(vehicle.seller.city, vehicle.seller.province)}`
                  : null}
              </p>
              <p className="mt-1 text-muted-foreground">
                Member since {formatDate(vehicle.seller.memberSince)}
              </p>
              {vehicle.seller.dealer?.verified ? (
                <Badge variant="success" className="mt-2">
                  <ShieldCheck className="h-3 w-3" aria-hidden />
                  Verified dealer
                </Badge>
              ) : null}
              {vehicle.seller.dealer ? (
                <Link
                  href={`/dealers/${vehicle.seller.dealer.slug}`}
                  className="mt-3 block text-sm text-primary hover:underline"
                >
                  View all inventory from this dealer
                </Link>
              ) : null}
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            Listed at {formatPrice(vehicle.priceCad)}
          </p>
        </div>
      </div>
    </div>
  );
}
