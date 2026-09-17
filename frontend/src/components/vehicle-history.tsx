import { AlertTriangle, FileText, ShieldCheck } from 'lucide-react';
import {
  ADVERSE_HISTORY_EVENT_KINDS,
  type CarfaxBadgeSource,
  type VehicleHistoryEvent,
  type VehicleHistoryEventKind,
} from '@vintrax/shared';
import { summariseAccidentRecord, type AccidentRecord } from '@/lib/vehicle-history';
import { formatDate } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui';
import { CarfaxBadge } from '@/components/carfax-badge';

/**
 * A vehicle's history, as a timeline.
 *
 * One wording decision runs through this component and is deliberate: it never
 * says "verified". Vintrax has no CARFAX integration and retrieves nothing —
 * these entries are transcribed by the seller from a report they hold, and the
 * report itself is the evidence. A badge reading "Verified" beside
 * seller-entered claims about accident history would be a false statement about
 * a car, made by us, on a page where someone is deciding whether to spend
 * twenty thousand dollars. So the block is labelled as the seller's account,
 * the date on their report is shown so a buyer can judge how current it is, and
 * the one thing Vintrax does verify — an independent inspection — keeps its own
 * separate block with a real inspector's name on it.
 *
 * There is no report date here any more. It came from an uploaded report file,
 * and issue #34 removed uploads — a CARFAX report reaches a buyer as a link.
 * Inventing a date from anything else would be worse than having none.
 *
 * Adverse entries are coloured from `kind`, not from the text beside them, so a
 * seller cannot soften a claim by wording it gently.
 */
export function VehicleHistory({
  events,
  vehicle,
}: {
  events: VehicleHistoryEvent[];
  vehicle: CarfaxBadgeSource;
}) {
  // Still drawn when the seller linked a report but entered no timeline: the
  // link is the useful half, and hiding the block would hide it.
  if (events.length === 0 && !vehicle.carfaxUrl) return null;

  const accidentRecord = summariseAccidentRecord(events);

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FileText className="h-4 w-4 text-primary" aria-hidden />
            Vehicle history
          </h2>
          <CarfaxBadge vehicle={vehicle} />
        </div>

        <p className="mt-1 text-sm text-muted-foreground">
          {events.length > 0
            ? 'Provided by the seller from their own history report. Vintrax has not checked it — read the report itself before you buy.'
            : 'The seller has linked a report but has not summarised it here. Open the report to read it.'}
        </p>

        <AccidentSummary record={accidentRecord} />

        {/* Horizontal on a wide screen, as a run of dated markers along a rule;
            vertical on a phone, where a row of six columns is unreadable. */}
        <ol className="mt-5 flex flex-col gap-4 md:flex-row md:gap-0">
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
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {event.occurredOn ? formatDate(event.occurredOn) : '—'}
                  </p>
                  <p
                    className={`text-sm font-medium ${
                      isAdverse(event.kind) ? 'text-destructive' : 'text-foreground'
                    }`}
                  >
                    {isAdverse(event.kind) ? (
                      <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                    ) : null}
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
      </CardContent>
    </Card>
  );
}

/**
 * The report's accident and damage record, called out above the timeline.
 *
 * This is the line a buyer looks for first, and until now it was a red dot
 * somewhere in a row of six. Pulling the count out does not hide the entries —
 * each one still appears on the timeline below with its date and what it says —
 * it just stops the one question everybody asks from depending on reading all
 * of them.
 *
 * Three states, and the third is the reason it is three. "No accidents
 * reported" is something the report says and the seller transcribed. Silence is
 * not: an empty timeline means nobody typed anything, and rendering that as
 * "no accidents" would turn an absence of data into a clean bill of health, on
 * the one field where that lie is worth the most money.
 */
function AccidentSummary({ record }: { record: AccidentRecord }) {
  if (record.state === 'reported') {
    const { accidents } = record;
    const total = accidents.length;

    return (
      <div className="mt-4 flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-destructive">
            {total === 1 ? '1 accident or damage record' : `${total} accident or damage records`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {accidents.map((accident) => (
              <li key={accident.id} className="text-sm text-muted-foreground">
                {accident.label}
                {accident.detail ? ` — ${accident.detail}` : ''}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (record.state === 'none') {
    return (
      <div className="mt-4 flex items-start gap-2.5 rounded-md border border-success/30 bg-success/5 px-3 py-2.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
        <p className="text-sm">
          <span className="font-semibold text-success">No accidents reported</span>
          <span className="text-muted-foreground">
            {' '}
            on the seller&rsquo;s report. Open it to see the date it was run.
          </span>
        </p>
      </div>
    );
  }

  // Said plainly rather than left blank, so the gap is visible as a gap.
  return (
    <p className="mt-4 text-sm text-muted-foreground">
      The seller has not said whether the report shows any accident or damage.
    </p>
  );
}

function isAdverse(kind: VehicleHistoryEventKind): boolean {
  return ADVERSE_HISTORY_EVENT_KINDS.includes(kind);
}

function dotFor(kind: VehicleHistoryEventKind): string {
  if (isAdverse(kind)) return 'bg-destructive';
  if (
    kind === 'NO_ACCIDENTS' ||
    kind === 'NO_CLAIMS' ||
    kind === 'SAFETY_CERTIFIED' ||
    kind === 'INSPECTION'
  ) {
    return 'bg-success';
  }
  return 'bg-primary';
}
