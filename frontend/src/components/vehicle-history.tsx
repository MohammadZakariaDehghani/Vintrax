import {
  type CarfaxBadgeSource,
  type VehicleHistoryEvent,
  type VehicleHistoryEventKind,
} from '@vintrax/shared';
import { FileText } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { visibleHistoryTimeline } from '@/lib/vehicle-history-drafts';
import { Card, CardContent } from '@/components/ui';
import { CarfaxBadge } from '@/components/carfax-badge';

/**
 * A vehicle's accident and damage record, as a timeline.
 *
 * Two sources feed it, on different terms, in the same list.
 *
 * A seller's own typed entries (`source: 'SELLER'`) show unconditionally, the
 * way this block has always worked — typing one and saving it through the
 * editor already is the seller publishing it, the same act it always was.
 * CARFAX-sourced entries show only once the seller has approved that specific
 * reading, because those were never typed by anyone here; reading a report and
 * publishing what it says are deliberately two acts. The two sets are simply
 * concatenated, not re-sorted, because the API already returns them in
 * `position` order with the seller's own rows first.
 *
 * A short-lived version of this component showed CARFAX entries only, on the
 * reasoning that once a report is being read automatically the seller's own
 * notes were no longer what the block was "for". That silently dropped a
 * feature that had nothing to do with CARFAX and had worked since before it
 * existed: a seller who has never linked a report, or whose report currently
 * cannot be read, still has an editor that says "these are published as your
 * account of it" — and until this fix, they were not being published anywhere
 * a buyer could see them.
 *
 * No explanatory prose beyond the heading either way. The seller's own editor
 * already says what these are; repeating it here is noise between the buyer
 * and the dates.
 */
export function VehicleHistory({
  events,
  vehicle,
}: {
  events: VehicleHistoryEvent[];
  vehicle: CarfaxBadgeSource & { carfaxHistoryApproved?: boolean };
}) {
  // Belt and braces over the API, which already withholds an unapproved
  // CARFAX reading from anyone but the owner: the owner is also a viewer of
  // their own listing, and should see what a buyer sees. The seller's own
  // rows carry no such gate — they were never behind a review step.
  const timeline = visibleHistoryTimeline(events, vehicle.carfaxHistoryApproved);

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
 * These entries are the server's reading of the report rather than anything a
 * seller typed, so this is less load-bearing than it was — but a parser that
 * one day reads a label it did not expect still must not be able to make a
 * collision look like routine service.
 */
function dotFor(kind: VehicleHistoryEventKind): string {
  return kind === 'NO_ACCIDENTS' ? 'bg-success' : 'bg-destructive';
}
