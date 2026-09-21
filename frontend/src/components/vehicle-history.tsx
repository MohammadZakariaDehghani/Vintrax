import {
  type CarfaxBadgeSource,
  type VehicleHistoryEvent,
  type VehicleHistoryEventKind,
} from '@vintrax/shared';
import { FileText } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui';
import { CarfaxBadge } from '@/components/carfax-badge';

/**
 * A vehicle's accident and damage record, as a timeline.
 *
 * Two sources, not shown alike. `SELLER` entries, typed through the history
 * editor, are the seller's own account and always shown — nothing gates
 * them. `CARFAX` entries are Vintrax's own extraction from the report at
 * `carfaxUrl`, and are shown only when `showVehicleHistory` is on: a dealer
 * can hold a report they are not ready to publish a timeline from, and this
 * is where that choice is applied. `historyEvents` on the API response
 * itself is unfiltered — the edit page needs the CARFAX rows even while this
 * toggle is off — so the filter has to happen here, not before it.
 */
export function VehicleHistory({
  events,
  vehicle,
}: {
  events: VehicleHistoryEvent[];
  vehicle: CarfaxBadgeSource & { showVehicleHistory: boolean };
}) {
  const timeline = vehicle.showVehicleHistory
    ? events
    : events.filter((event) => event.source !== 'CARFAX');

  // Nothing to show and nothing to link to: an empty card with a heading is
  // worse than no card. A seller who has typed their own entries gets the
  // block even with no CARFAX link at all, exactly as before CARFAX reading
  // existed; the badge below draws nothing without a link either way.
  if (timeline.length === 0 && !vehicle.carfaxUrl) return null;

  return (
    <Card>
      <CardContent className="pt-5">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <FileText className="h-4 w-4 text-primary" aria-hidden />
          Vehicle history
        </h2>

        {timeline.length > 0 ? (
          <ol className="mb-5 flex flex-col gap-4 md:flex-row md:gap-0">
            {timeline.map((event, index) => (
              <li key={event.id} className="relative flex-1 md:pr-4">
                <div className="flex items-start gap-3 md:block">
                  <div className="flex items-center md:mb-2">
                    <span
                      aria-hidden
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotFor(event.kind)}`}
                    />
                    {/* The rule joining one marker to the next. Not drawn after
                        the last, which would trail off into nothing. */}
                    {index < timeline.length - 1 ? (
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

        <CarfaxBadge vehicle={vehicle} />
      </CardContent>
    </Card>
  );
}

/**
 * Colour comes from the kind, never from the words beside it.
 *
 * Some of these entries are Vintrax's own extraction rather than anything a
 * seller typed, so a parser that reads a label it did not expect still must
 * not be able to make a collision look like routine service.
 */
function dotFor(kind: VehicleHistoryEventKind): string {
  return kind === 'NO_ACCIDENTS' ? 'bg-success' : 'bg-destructive';
}
