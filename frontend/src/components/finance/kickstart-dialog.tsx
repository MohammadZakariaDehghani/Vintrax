'use client';

import type { VehicleDetail } from '@vintrax/shared';
import { formatPrice } from '@/lib/utils';
import { Button, Dialog, ErrorAlert } from '@/components/ui';

/**
 * Shown when a buyer presses "Send message" on a listing whose seller takes
 * finance applications: start the finance application now, or just send the
 * message. The phone mock-up shows the car they are looking at, not a stock
 * picture.
 */
export function KickstartDialog({
  vehicle,
  open,
  onClose,
  onFinance,
  onSendMessage,
  sending,
  error,
}: {
  vehicle: VehicleDetail;
  open: boolean;
  onClose: () => void;
  onFinance: () => void;
  onSendMessage: () => void;
  sending: boolean;
  /** Why sending the message failed, if it did. */
  error?: unknown;
}) {
  const sellerName = vehicle.seller.dealer?.name ?? vehicle.seller.displayName;
  const photo = vehicle.images[0]?.url ?? vehicle.primaryImageUrl;

  return (
    <Dialog open={open} onClose={onClose} title="Kickstart your process" size="md">
      <div className="text-center">
        <p className="text-2xl font-bold tracking-tight sm:text-3xl">
          Start online, save time later
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Check financing, send over trade-in details, and pick a day to visit {sellerName} — all in
          a few minutes.
        </p>

        {/* A phone showing this listing: rounded frame, notch, the car and its price. */}
        <div className="mx-auto mt-6 h-64 w-56 overflow-hidden rounded-t-[2.25rem] border-[7px] border-b-0 border-foreground/90 bg-card shadow-lg">
          <div className="mx-auto mt-1.5 h-4 w-20 rounded-full bg-foreground/90" aria-hidden />
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="font-display text-sm font-bold uppercase tracking-wide text-primary">
              Vintrax
            </span>
            <span className="text-[10px] text-muted-foreground">{vehicle.city}</span>
          </div>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className="h-32 w-full object-cover" />
          ) : (
            <div className="h-32 bg-secondary" aria-hidden />
          )}
          <div className="px-3 py-2 text-left">
            <p className="truncate text-xs font-semibold">{vehicle.title}</p>
            <p className="tabular text-xs text-muted-foreground">{formatPrice(vehicle.priceCad)}</p>
          </div>
        </div>
      </div>

      <div className="-mx-5 border-t border-border px-5 pt-4">
        <ErrorAlert error={error} className="mb-3" />
        <Button type="button" className="w-full rounded-full" onClick={onFinance}>
          See finance &amp; trade-in options
        </Button>
        <Button
          type="button"
          variant="link"
          className="mt-2 w-full"
          loading={sending}
          onClick={onSendMessage}
        >
          No, send my request
        </Button>
      </div>
    </Dialog>
  );
}
