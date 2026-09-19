'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import type { ConversationDetail, VehicleDetail } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn, formatEnum, formatKm, formatPrice } from '@/lib/utils';
import { useUser } from '@/store/auth-store';
import { Button, Card, CardContent, ErrorAlert, Textarea } from '@/components/ui';

export function ContactSellerPanel({ vehicle }: { vehicle: VehicleDetail }) {
  const user = useUser();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState(
    `Hi, I'm interested in your ${vehicle.year} ${vehicle.make} ${vehicle.model}. Is it still available?`,
  );

  const isOwnListing = user?.id === vehicle.seller.id;

  const sendEnquiry = useMutation({
    mutationFn: (body: string) =>
      api.post<ConversationDetail>('/conversations', { vehicleId: vehicle.id, body }),
    onSuccess: (conversation) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      router.push(`/dashboard/messages/${conversation.id}`);
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
            <p className="mb-3 text-sm">Sign in to message the seller or save this vehicle.</p>
            <Link href="/login">
              <Button className="w-full">Sign in to continue</Button>
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
              sendEnquiry.mutate(message);
            }}
          >
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

            <ErrorAlert error={sendEnquiry.error} className="mt-3" />

            <Button
              type="submit"
              className="mt-3 w-full"
              loading={sendEnquiry.isPending}
              disabled={!message.trim()}
            >
              Send message
            </Button>

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
          </form>
        )}
      </CardContent>
    </Card>
  );
}
