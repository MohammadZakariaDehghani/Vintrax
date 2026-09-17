import {
  type CarfaxBadgeSource,
  type VehicleHistoryEvent,
  type VehicleHistoryEventKind,
} from '@vintrax/shared';
import { formatDate } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui';
import { CarfaxBadge } from '@/components/carfax-badge';

/**
 * A vehicle's accident and damage record, as a timeline.
 *
 * Two states, and nothing else in the box.
 *
 * The seller approved the reading of their CARFAX report → the timeline, and
 * the CARFAX button. The seller did not, or there is nothing to show → the
 * button alone. No explanation, no disclaimer, no summary line. That is the
 * point of the block as it now stands: the report is one click away, and a
 * paragraph of ours between the buyer and it is noise they have to read past.
 *
 * What made the old prose necessary was that the entries were typed by the
 * seller, so the block had to say whose claim it was. It no longer has to. The
 * lines drawn here come from `source: 'CARFAX'` only — read off the report by
 * the server, never editable, never postable from a browser — so the timeline
 * is the report's account, and the button goes to the report itself.
 *
 * A seller's own typed entries still exist and still have their editor; they
 * are simply not what this block is for any more.
 */
export function VehicleHistory({
  events,
  vehicle,
}: {
  events: VehicleHistoryEvent[];
  vehicle: CarfaxBadgeSource & { carfaxHistoryApproved?: boolean };
}) {
  // No report, no box. The badge draws nothing without a link, and an empty
  // card with a heading is worse than no card.
  if (!vehicle.carfaxUrl) return null;

  // Belt and braces over the API, which already withholds unapproved entries
  // from anyone but the owner: the owner is also a viewer of their own
  // listing, and they should see what a buyer sees.
  const timeline = vehicle.carfaxHistoryApproved
    ? events.filter((event) => event.source === 'CARFAX')
    : [];

  return (
    <Card>
      <CardContent className="pt-5">
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
 * These entries are the server's reading of the report rather than anything a
 * seller typed, so this is less load-bearing than it was — but a parser that
 * one day reads a label it did not expect still must not be able to make a
 * collision look like routine service.
 */
function dotFor(kind: VehicleHistoryEventKind): string {
  return kind === 'NO_ACCIDENTS' ? 'bg-success' : 'bg-destructive';
}
