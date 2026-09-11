'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Gavel } from 'lucide-react';
import type { AuctionDetail, Paginated, VehicleSummary } from '@vintrax/shared';
import { createAuctionSchema } from '@vintrax/shared';
import { api, ApiError } from '@/lib/api-client';
import { formatKm, formatPrice } from '@/lib/utils';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in the viewer's own zone. */
function localInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function NewAuction() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<Error | null>(null);

  const now = new Date();
  const [form, setForm] = useState({
    vehicleId: searchParams.get('vehicleId') ?? '',
    title: '',
    startingBidCad: '',
    reservePriceCad: '',
    buyNowPriceCad: '',
    startsAt: localInputValue(new Date(now.getTime() + 60 * 60_000)),
    endsAt: localInputValue(new Date(now.getTime() + 7 * 24 * 60 * 60_000)),
  });

  // Only a published listing can go to auction, and only one the caller owns.
  const inventory = useQuery({
    queryKey: ['my-inventory', 'ACTIVE', 'auctionable'],
    queryFn: () =>
      api.get<Paginated<VehicleSummary>>('/vehicles/mine?status=ACTIVE&page=1&pageSize=60'),
  });

  const candidates = inventory.data?.items ?? [];
  const selected = candidates.find((vehicle) => vehicle.id === form.vehicleId);

  const create = useMutation({
    mutationFn: (input: unknown) => api.post<AuctionDetail>('/auctions', input),
    onSuccess: (auction) => router.replace(`/auctions/${auction.id}`),
  });

  function set(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Validated against the shared schema first, so the cross-field rules —
    // reserve at or above the starting bid, buy-now above it, end after start
    // — are reported next to the fields rather than as one server error.
    const parsed = createAuctionSchema.safeParse({
      vehicleId: form.vehicleId,
      title: form.title.trim() || undefined,
      startingBidCad: Number(form.startingBidCad),
      reservePriceCad: form.reservePriceCad ? Number(form.reservePriceCad) : undefined,
      buyNowPriceCad: form.buyNowPriceCad ? Number(form.buyNowPriceCad) : undefined,
      startsAt: form.startsAt ? new Date(form.startsAt) : undefined,
      endsAt: form.endsAt ? new Date(form.endsAt) : undefined,
    });

    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        details[key] = [...(details[key] ?? []), issue.message];
      }
      setError(new ApiError(400, 'Check the highlighted fields', details));
      return;
    }

    create.mutate({
      ...parsed.data,
      startsAt: parsed.data.startsAt.toISOString(),
      endsAt: parsed.data.endsAt.toISOString(),
    });
  }

  const shown = error ?? create.error;
  const fieldError = (name: string) =>
    shown instanceof ApiError ? shown.fieldError(name) : undefined;

  if (inventory.isPending) return <Spinner label="Loading your inventory" />;

  if (candidates.length === 0) {
    return (
      <div className="container py-8">
        <Card>
          <EmptyState
            icon={<Gavel className="h-8 w-8" aria-hidden />}
            title="No published vehicles to auction"
            description="A vehicle has to be live on the marketplace before it can go to auction. Submit a draft for review, and an administrator publishes it."
            action={
              <Link href="/dealer/inventory">
                <Button>Go to inventory</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-8">
      <h1 className="text-3xl font-bold tracking-tight">Run an auction</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Bidding is live and timed. A bid inside the final two minutes extends the clock, so an
        auction cannot be won by sniping.
      </p>

      <ErrorAlert error={shown} className="mt-5" />

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Vehicle</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Listing" htmlFor="vehicleId" error={fieldError('vehicleId')}>
              <Select
                id="vehicleId"
                value={form.vehicleId}
                onChange={(event) => set('vehicleId', event.target.value)}
              >
                <option value="">Choose a published vehicle</option>
                {candidates.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.title}
                  </option>
                ))}
              </Select>
            </Field>

            {selected ? (
              <p className="text-sm text-muted-foreground">
                Listed at {formatPrice(selected.priceCad)} · {formatKm(selected.mileageKm)}
              </p>
            ) : null}

            <Field
              label="Auction title"
              htmlFor="title"
              hint="Optional. Defaults to the listing title."
              error={fieldError('title')}
            >
              <Input
                id="title"
                value={form.title}
                onChange={(event) => set('title', event.target.value)}
                placeholder={selected?.title ?? ''}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pricing</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Starting bid"
              htmlFor="startingBidCad"
              error={fieldError('startingBidCad')}
            >
              <Input
                id="startingBidCad"
                type="number"
                min={1}
                step={1}
                value={form.startingBidCad}
                onChange={(event) => set('startingBidCad', event.target.value)}
              />
            </Field>
            <Field
              label="Reserve"
              htmlFor="reservePriceCad"
              hint="Never shown to bidders."
              error={fieldError('reservePriceCad')}
            >
              <Input
                type="number"
                min={0}
                step={1}
                id="reservePriceCad"
                value={form.reservePriceCad}
                onChange={(event) => set('reservePriceCad', event.target.value)}
              />
            </Field>
            <Field
              label="Buy now"
              htmlFor="buyNowPriceCad"
              hint="Optional."
              error={fieldError('buyNowPriceCad')}
            >
              <Input
                type="number"
                min={0}
                step={1}
                id="buyNowPriceCad"
                value={form.buyNowPriceCad}
                onChange={(event) => set('buyNowPriceCad', event.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" htmlFor="startsAt" error={fieldError('startsAt')}>
              <Input
                id="startsAt"
                type="datetime-local"
                value={form.startsAt}
                onChange={(event) => set('startsAt', event.target.value)}
              />
            </Field>
            <Field label="Ends" htmlFor="endsAt" error={fieldError('endsAt')}>
              <Input
                id="endsAt"
                type="datetime-local"
                value={form.endsAt}
                onChange={(event) => set('endsAt', event.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Link href="/dealer/inventory">
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          <Button type="submit" loading={create.isPending}>
            Start the auction
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NewAuctionPage() {
  return (
    <RequireAuth sellersOnly>
      {/* useSearchParams needs a suspense boundary to prerender this route. */}
      <Suspense fallback={<Spinner />}>
        <NewAuction />
      </Suspense>
    </RequireAuth>
  );
}
