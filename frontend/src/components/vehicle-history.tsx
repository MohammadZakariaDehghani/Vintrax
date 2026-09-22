import { activeVehicleBadges, type VehicleBadges, type VehicleHistoryEvent } from '@vintrax/shared';
import { FileText } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui';
import { VehicleBadgeStrip } from '@/components/vehicle-badge-strip';

/**
 * A vehicle's accident and damage record, as a timeline, entered manually by
 * the dealer — there is no CARFAX integration reading or generating any of
 * it (issue #67). Every entry is always shown; there is no publish toggle,
 * since nothing here is auto-populated for a dealer to review before showing.
 */
export function VehicleHistory({
  events,
  vehicle,
}: {
  events: VehicleHistoryEvent[];
  vehicle: { carfaxUrl?: string | null; badges: VehicleBadges };
}) {
  // Nothing to show and nothing to link to: an empty card with a heading is
  // worse than no card.
  if (events.length === 0 && activeVehicleBadges(vehicle.badges).length === 0) return null;

  return (
    <Card>
      <CardContent className="pt-5">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <FileText className="h-4 w-4 text-primary" aria-hidden />
          Vehicle history
        </h2>

        {events.length > 0 ? (
          <ol className="mb-5 flex flex-col gap-4 md:flex-row md:gap-0">
            {events.map((event, index) => (
              <li key={event.id} className="relative flex-1 md:pr-4">
                <div className="flex items-start gap-3 md:block">
                  <div className="flex items-center md:mb-2">
                    <span
                      aria-hidden
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotFor(event.kind)}`}
                    />
                    {/* The rule joining one marker to the next. Not drawn after
                        the last, which would trail off into nothing. */}
                    {index < events.length - 1 ? (
                      <span aria-hidden className="ml-1 hidden h-px flex-1 bg-border md:block" />
                    ) : null}
                  </div>

                  <div className="min-w-0">
                    {/* No placeholder dash. A dated run of markers wants the
                        column to line up, but "no accidents reported" carries
                        no date at all, and a lone em dash above it reads as a
                        date that failed to load. */}
                    {event.occurredOn ? (
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {formatDate(event.occurredOn)}
                      </p>
                    ) : null}
                    <p
                      className={`text-sm font-medium ${
                        event.kind === 'NO_ACCIDENTS' ? 'text-success' : 'text-destructive'
                      }`}
                    >
                      {event.label}
                    </p>
                    {event.detail ? (
                      <p className="text-sm text-muted-foreground">{event.detail}</p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : null}

        <VehicleBadgeStrip vehicle={vehicle} />
      </CardContent>
    </Card>
  );
}

/**
 * Colour comes from the kind, never from the words beside it.
 *
 * A parser once read this timeline automatically and could have read a label
 * it did not expect; that risk is gone with the automatic extraction (issue
 * #67), but every entry here is still what a dealer typed, not something
 * Vintrax verified, so a collision is still never allowed to look like
 * routine service by colour alone.
 */
function dotFor(kind: VehicleHistoryEvent['kind']): string {
  return kind === 'NO_ACCIDENTS' ? 'bg-success' : 'bg-destructive';
}
