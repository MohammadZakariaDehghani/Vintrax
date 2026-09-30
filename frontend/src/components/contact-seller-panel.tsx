'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Heart, Landmark, Phone } from 'lucide-react';
import type {
  ConversationDetail,
  SellerContact,
  VehicleDetail,
  VehicleFinanceOptions,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn, formatEnum, formatKm, formatPrice } from '@/lib/utils';
import { useUser } from '@/store/auth-store';
import { Button, Card, CardContent, ErrorAlert, Textarea } from '@/components/ui';
import { PreviousPrice } from '@/components/previous-price';
import { FinanceApplicationDialog } from '@/components/finance/finance-application-dialog';
import { KickstartDialog } from '@/components/finance/kickstart-dialog';

/**
 * The seller's phone number, fetched only when a signed-in visitor asks for it.
 * The number is not in the listing payload, so it cannot be read off every
 * page by anyone crawling the catalogue.
 */
function ShowPhoneNumber({ vehicleId }: { vehicleId: string }) {
  const reveal = useMutation({
    mutationFn: () => api.get<SellerContact>(`/vehicles/${vehicleId}/contact`),
  });

  if (reveal.data) {
    return reveal.data.phone ? (
      <a
        href={`tel:${reveal.data.phone.replace(/[^\d+]/g, '')}`}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
      >
        <Phone className="h-4 w-4" aria-hidden />
        <span>
          {reveal.data.name}: <span className="tabular">{reveal.data.phone}</span>
        </span>
      </a>
    ) : (
      <p className="mt-2 text-center text-sm text-muted-foreground">
        {reveal.data.name} has not added a phone number. Send them a message instead.
      </p>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="mt-2 w-full"
        loading={reveal.isPending}
        onClick={() => reveal.mutate()}
      >
        <Phone className="h-4 w-4" aria-hidden />
        Show phone number
      </Button>
      <ErrorAlert error={reveal.error} className="mt-2" />
    </>
  );
}

export function ContactSellerPanel({ vehicle }: { vehicle: VehicleDetail }) {
  const user = useUser();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState(
    `Hi, I'm interested in your ${vehicle.year} ${vehicle.make} ${vehicle.model}. Is it still available?`,
  );

  const [chooserOpen, setChooserOpen] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);

  const isOwnListing = user?.id === vehicle.seller.id;

  // Whether the seller takes finance applications, and whether this buyer
  // already sent one. Only asked for a live listing someone else is selling.
  const finance = useQuery({
    queryKey: ['finance-options', vehicle.id, user?.id],
    queryFn: () => api.get<VehicleFinanceOptions>(`/vehicles/${vehicle.id}/finance-options`),
    enabled: !!user && !isOwnListing && vehicle.status === 'ACTIVE',
    staleTime: 60_000,
  });
  const canApply = finance.data?.acceptsApplications === true && !finance.data.openApplicationId;

  const sendEnquiry = useMutation({
    mutationFn: (body: string) =>
      api.post<ConversationDetail>('/conversations', { vehicleId: vehicle.id, body }),
    onSuccess: (conversation) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setChooserOpen(false);
      router.push(`/vehicles/${vehicle.slug}/sent?c=${encodeURIComponent(conversation.id)}`);
    },
  });

  const toggleFavourite = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) await api.put(`/vehicles/${vehicle.id}/favourite`);
      else await api.delete(`/vehicles/${vehicle.id}/favourite`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      void queryClient.invalidateQueries({ queryKey: ['favourites'] });
      router.refresh();
    },
  });

  return (
    <Card>
      <CardContent className="pt-5">
        <PreviousPrice
          previous={vehicle.previousPriceCad}
          current={vehicle.priceCad}
          className="text-base"
        />
        <p className="tabular text-3xl font-bold text-primary">{formatPrice(vehicle.priceCad)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatKm(vehicle.mileageKm)} · {formatEnum(vehicle.condition)}
        </p>

        <hr className="my-4 border-border" />

        {isOwnListing ? (
          <>
            <p className="mb-3 text-sm text-muted-foreground">This is your listing.</p>
            <Link href={`/dealer/inventory/${vehicle.id}`}>
              <Button className="w-full">Edit listing</Button>
            </Link>
          </>
        ) : !user ? (
          <>
            <p className="mb-3 text-sm">
              Sign in to message the seller, see their phone number or save this vehicle.
            </p>
            <Link href={`/login?from=${encodeURIComponent(`/vehicles/${vehicle.slug}`)}`}>
              <Button className="w-full">Sign in to continue</Button>
            </Link>
            <Link href={`/login?from=${encodeURIComponent(`/vehicles/${vehicle.slug}`)}`}>
              <Button type="button" variant="outline" className="mt-2 w-full">
                <Phone className="h-4 w-4" aria-hidden />
                Show phone number
              </Button>
            </Link>
          </>
        ) : vehicle.status === 'SOLD' ? (
          <p className="text-sm text-muted-foreground">This vehicle has been sold.</p>
        ) : vehicle.status === 'IN_AUCTION' && vehicle.activeAuction ? (
          <Link href={`/auctions/${vehicle.activeAuction.id}`}>
            <Button className="w-full">Go to live auction</Button>
          </Link>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              // Offer the finance application first, when the seller takes one.
              if (canApply) setChooserOpen(true);
              else sendEnquiry.mutate(message);
            }}
          >
            {canApply ? (
              <Button
                type="button"
                className="mb-4 w-full rounded-full"
                onClick={() => setFinanceOpen(true)}
              >
                <Landmark className="h-4 w-4" aria-hidden />
                See finance &amp; trade-in options
              </Button>
            ) : finance.data?.openApplicationId ? (
              <p className="mb-4 flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm">
                <BadgeCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />
                Your finance application was sent. The seller will be in touch.
              </p>
            ) : null}

            <label htmlFor="enquiry" className="text-sm font-medium">
              Message the seller
            </label>
            <Textarea
              id="enquiry"
              className="mt-1.5"
              value={message}
              maxLength={4000}
              required
              onChange={(event) => setMessage(event.target.value)}
            />

            <ErrorAlert error={chooserOpen ? null : sendEnquiry.error} className="mt-3" />

            <Button
              type="submit"
              className="mt-3 w-full"
              loading={sendEnquiry.isPending}
              disabled={!message.trim()}
            >
              Send message
            </Button>

            <ShowPhoneNumber vehicleId={vehicle.id} />

            <Button
              type="button"
              variant="outline"
              className="mt-2 w-full"
              loading={toggleFavourite.isPending}
              onClick={() => toggleFavourite.mutate(!vehicle.isFavourited)}
            >
              <Heart
                className={cn(
                  'h-4 w-4',
                  vehicle.isFavourited && 'fill-destructive text-destructive',
                )}
                aria-hidden
              />
              {vehicle.isFavourited ? 'Saved' : 'Save this vehicle'}
            </Button>

            {canApply ? (
              <>
                <KickstartDialog
                  vehicle={vehicle}
                  open={chooserOpen}
                  onClose={() => setChooserOpen(false)}
                  sending={sendEnquiry.isPending}
                  error={sendEnquiry.error}
                  onSendMessage={() => sendEnquiry.mutate(message)}
                  onFinance={() => {
                    setChooserOpen(false);
                    setFinanceOpen(true);
                  }}
                />
                <FinanceApplicationDialog
                  vehicle={vehicle}
                  open={financeOpen}
                  onClose={() => setFinanceOpen(false)}
                  initialComments={message}
                />
              </>
            ) : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
