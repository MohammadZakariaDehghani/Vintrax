'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Gavel, Heart, MessageSquare, ShieldCheck } from 'lucide-react';
import { vintrax } from '@/lib/vintrax';
import { useToggleFavourite, useVehicle } from '@/lib/queries';
import { useUser } from '@/store/session';
import { cn, formatEnum, formatKm, formatPrice, formatRelativeTime } from '@/lib/format';
import { Badge, Button, Card, Field, Spinner, StateMessage } from '@/components/ui';
import { AppBar } from '@/components/app-bar';
import { Gallery } from '@/components/gallery';
import { ErrorState } from '@/components/error-state';
import { Countdown } from '@/components/countdown';
import { DescriptionBody } from '@/components/description-body';

export default function VehiclePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const user = useUser();
  const vehicleQuery = useVehicle(slug);
  const toggleFavourite = useToggleFavourite();

  if (vehicleQuery.isPending) {
    return (
      <>
        <AppBar title="Vehicle" back />
        <Spinner label="Loading vehicle" />
      </>
    );
  }

  if (vehicleQuery.isError) {
    return (
      <>
        <AppBar title="Vehicle" back />
        <ErrorState error={vehicleQuery.error} onRetry={() => void vehicleQuery.refetch()} />
      </>
    );
  }

  const vehicle = vehicleQuery.data;
  const auction = vehicle.activeAuction;

  const specs: Array<[string, string]> = [
    ['Mileage', formatKm(vehicle.mileageKm)],
    ['Body', formatEnum(vehicle.bodyType)],
    ['Transmission', formatEnum(vehicle.transmission)],
    ['Drivetrain', formatEnum(vehicle.drivetrain)],
    ['Fuel', formatEnum(vehicle.fuelType)],
    ['Condition', formatEnum(vehicle.condition)],
    ...(vehicle.exteriorColour
      ? ([['Exterior', vehicle.exteriorColour]] as Array<[string, string]>)
      : []),
    ...(vehicle.vin ? ([['VIN', vehicle.vin]] as Array<[string, string]>) : []),
  ];

  return (
    <>
      <AppBar
        title={`${vehicle.year} ${vehicle.make}`}
        back
        action={
          user ? (
            <button
              type="button"
              onClick={() =>
                toggleFavourite.mutate({
                  vehicleId: vehicle.id,
                  favourited: vehicle.isFavourited,
                })
              }
              aria-pressed={vehicle.isFavourited}
              aria-label={vehicle.isFavourited ? 'Remove from saved' : 'Save this vehicle'}
              className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg active:bg-secondary"
            >
              <Heart
                aria-hidden
                className={cn('h-6 w-6', vehicle.isFavourited && 'fill-current text-destructive')}
              />
            </button>
          ) : null
        }
      />

      <Gallery images={vehicle.images} title={vehicle.title} />

      <div className="space-y-4 p-4">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold">{vehicle.title}</h1>
          <p className="text-sm text-muted-foreground">
            {vehicle.city}, {vehicle.province}
          </p>
        </header>

        {auction ? (
          <Card className="space-y-3 border-warning p-4">
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Current bid</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatPrice(auction.currentBidCad)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Ends in</p>
                <Countdown endsAt={auction.endsAt} className="text-base font-medium" />
              </div>
            </div>
            <Button size="large" fullWidth onClick={() => router.push(`/auctions/${auction.id}`)}>
              <Gavel aria-hidden className="h-4 w-4" />
              Go to auction
            </Button>
          </Card>
        ) : (
          <p className="text-3xl font-semibold tabular-nums">{formatPrice(vehicle.priceCad)}</p>
        )}

        {vehicle.inspection ? (
          <Card className="space-y-2 p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden className="h-5 w-5 text-success" />
              <h2 className="text-base font-semibold">Inspection report</h2>
              {vehicle.inspection.overallGrade ? (
                <Badge tone="success">Grade {vehicle.inspection.overallGrade}</Badge>
              ) : null}
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Frame damage</dt>
                <dd className="font-medium">{yesNo(vehicle.inspection.hasFrameDamage)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Accident history</dt>
                <dd className="font-medium">{yesNo(vehicle.inspection.hasAccidentHistory)}</dd>
              </div>
            </dl>
          </Card>
        ) : null}

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Specifications</h2>
          <Card>
            <dl className="divide-y divide-border">
              {specs.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="text-sm font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </section>

        {vehicle.features.length > 0 ? (
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Features</h2>
            <ul className="flex flex-wrap gap-2">
              {vehicle.features.map((feature) => (
                <li
                  key={feature}
                  className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground"
                >
                  {feature}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Description</h2>
          <DescriptionBody description={vehicle.description} />
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Seller</h2>
          <Card className="space-y-1 p-4">
            <p className="font-medium">
              {vehicle.seller.dealer?.name ?? vehicle.seller.displayName}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatEnum(vehicle.seller.role)}
              {vehicle.seller.dealer?.verified ? ' · Verified dealer' : ''}
            </p>
            <p className="text-xs text-muted-foreground">
              Listed {formatRelativeTime(vehicle.publishedAt ?? vehicle.createdAt)}
            </p>
          </Card>
        </section>

        {!auction ? <ContactSeller vehicleId={vehicle.id} /> : null}
      </div>
    </>
  );
}

function yesNo(value: boolean | null): string {
  if (value === null) return 'Not reported';
  return value ? 'Yes' : 'No';
}

/**
 * Starts a conversation through the existing messaging API. The server owns
 * the rule that a buyer gets one conversation per vehicle.
 */
function ContactSeller({ vehicleId }: { vehicleId: string }) {
  const user = useUser();
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [sending, setSending] = useState(false);

  if (!user) {
    return (
      <StateMessage
        title="Sign in to contact the seller"
        action={<Button onClick={() => router.push('/login?next=/messages')}>Sign in</Button>}
      />
    );
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const conversation = await vintrax.conversations.start(vehicleId, body.trim());
      router.push(`/messages/${conversation.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Could not send the message'));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Message the seller</h2>
      <Card className="p-4">
        <form onSubmit={send} className="space-y-3">
          <Field
            label="Your message"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Is this still available?"
            required
          />
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error.message}
            </p>
          ) : null}
          <Button type="submit" size="large" fullWidth loading={sending} disabled={!body.trim()}>
            <MessageSquare aria-hidden className="h-4 w-4" />
            Send message
          </Button>
        </form>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        Replies arrive in{' '}
        <Link href="/messages" className="text-primary underline">
          Messages
        </Link>
        .
      </p>
    </section>
  );
}
