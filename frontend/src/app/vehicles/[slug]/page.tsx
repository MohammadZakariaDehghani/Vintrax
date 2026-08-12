import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { MapPin, ShieldCheck } from 'lucide-react';
import type { VehicleDetail } from '@atlas/shared';
import { serverFetch } from '@/lib/api-client';
import { formatDate, formatEnum, formatKm, formatLocation, formatPrice } from '@/lib/utils';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { VehicleGallery } from '@/components/vehicle-gallery';
import { ContactSellerPanel } from '@/components/contact-seller-panel';
import { InspectionReport } from '@/components/inspection-report';

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
    ...(vehicle.cylinders ? ([['Cylinders', String(vehicle.cylinders)]] as Array<[string, string]>) : []),
    ...(vehicle.seats ? ([['Seats', String(vehicle.seats)]] as Array<[string, string]>) : []),
    ...(vehicle.exteriorColour ? ([['Exterior', vehicle.exteriorColour]] as Array<[string, string]>) : []),
    ...(vehicle.interiorColour ? ([['Interior', vehicle.interiorColour]] as Array<[string, string]>) : []),
    ...(vehicle.vin ? ([['VIN', vehicle.vin]] as Array<[string, string]>) : []),
  ];

  return (
    <div className="container py-8">
      <nav className="mb-4 text-sm" aria-label="Breadcrumb">
        <Link href="/vehicles" className="text-muted-foreground hover:text-foreground">
          ← Back to results
        </Link>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle as="h1" className="text-2xl">{vehicle.title}</CardTitle>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {formatLocation(vehicle.city, vehicle.province)} ·{' '}
                    <span className="tabular">{vehicle.viewCount.toLocaleString('en-CA')}</span> views
                  </p>
                </div>
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
            </CardHeader>
            <CardContent>
              <VehicleGallery images={vehicle.images} title={vehicle.title} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Vehicle details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {specs.map(([label, value]) => (
                  <div key={label} className="border-b border-border pb-2">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
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

          {vehicle.inspection ? <InspectionReport vehicleId={vehicle.id} /> : null}

          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {vehicle.description}
              </p>
            </CardContent>
          </Card>

          {vehicle.documents.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2">
                  {vehicle.documents.map((document) => (
                    <li key={document.id}>
                      <a
                        href={document.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-primary hover:underline"
                      >
                        {formatEnum(document.type)} — {document.filename}
                      </a>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <ContactSellerPanel vehicle={vehicle} />

          <Card className="mt-4">
            <CardContent className="pt-5 text-sm">
              <p className="font-semibold">
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

          <p className="mt-3 text-center text-xs text-muted-foreground">
            Listed at {formatPrice(vehicle.priceCad)}
          </p>
        </div>
      </div>
    </div>
  );
}
