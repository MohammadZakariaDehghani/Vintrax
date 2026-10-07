'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Card, ErrorAlert, Select, Spinner } from '@/components/ui';
import { useCrm } from '@/components/crm/context';
import { PageHeader, Tabs, useCrmQuery } from '@/components/crm/ui';
import { personName, qs, time } from '@/lib/crm';

type Mode = 'DAY' | 'WEEK' | 'MONTH';

interface CalendarEvent {
  kind: 'APPOINTMENT' | 'TASK';
  id: string;
  title: string;
  type: string;
  status: string;
  startsAt: string;
  endsAt: string;
  leadId: string | null;
  person: { firstName: string; lastName: string } | null;
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Day, week and month views of appointments and dated tasks, in the browser's time zone. */
export default function CalendarPage() {
  const { me, can } = useCrm();
  const [mode, setMode] = useState<Mode>('WEEK');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [person, setPerson] = useState('');

  const { from, to, days } = useMemo(() => {
    if (mode === 'DAY') return { from: anchor, to: addDays(anchor, 1), days: [anchor] };
    if (mode === 'WEEK') {
      const monday = addDays(anchor, -((anchor.getDay() + 6) % 7));
      return {
        from: monday,
        to: addDays(monday, 7),
        days: Array.from({ length: 7 }, (_, i) => addDays(monday, i)),
      };
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = addDays(first, -((first.getDay() + 6) % 7));
    return {
      from: gridStart,
      to: addDays(gridStart, 42),
      days: Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)),
    };
  }, [mode, anchor]);

  const calendar = useCrmQuery<{ events: CalendarEvent[] }>(
    ['calendar', from.toISOString(), to.toISOString(), person],
    `/calendar${qs({ from: from.toISOString(), to: to.toISOString(), salespersonId: person })}`,
  );
  const events = calendar.data?.events ?? [];
  const step = (direction: 1 | -1) =>
    setAnchor((current) =>
      mode === 'DAY'
        ? addDays(current, direction)
        : mode === 'WEEK'
          ? addDays(current, 7 * direction)
          : new Date(current.getFullYear(), current.getMonth() + direction, 1),
    );
  const title =
    mode === 'MONTH'
      ? anchor.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
      : mode === 'WEEK'
        ? `${days[0]!.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })} – ${days[6]!.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}`
        : anchor.toLocaleDateString('en-CA', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          });

  const Item = ({ event }: { event: CalendarEvent }) => (
    <Link
      href={event.leadId ? `/dealer/crm/leads/${event.leadId}` : '/dealer/crm/tasks'}
      className={`block truncate rounded px-1.5 py-0.5 text-xs ${event.kind === 'APPOINTMENT' ? 'bg-primary/10 text-primary' : 'bg-warning/15 text-warning'} ${event.status === 'CANCELLED' || event.status === 'COMPLETED' ? 'line-through opacity-60' : ''}`}
      title={`${event.title}${event.person ? ` · ${personName(event.person)}` : ''}`}
    >
      {time(event.startsAt)} {event.title}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Appointments (blue) and tasks with a due time (amber)."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" aria-label="Previous" onClick={() => step(-1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(startOfDay(new Date()))}>
            Today
          </Button>
          <Button size="sm" variant="outline" aria-label="Next" onClick={() => step(1)}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          <h2 className="ml-2 text-lg font-semibold">{title}</h2>
        </div>
        {can('crm.all_leads') ? (
          <Select
            aria-label="Salesperson"
            className="h-9 w-48"
            value={person}
            onChange={(event) => setPerson(event.target.value)}
          >
            <option value="">Everyone</option>
            {me.staff.map((member) => (
              <option key={member.id} value={member.id}>
                {personName(member)}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      <Tabs
        label="Calendar view"
        value={mode}
        onChange={setMode}
        tabs={[
          { id: 'DAY', label: 'Day' },
          { id: 'WEEK', label: 'Week' },
          { id: 'MONTH', label: 'Month' },
        ]}
      />
      <ErrorAlert error={calendar.error} />
      {calendar.isPending && !calendar.data ? <Spinner /> : null}
      {mode === 'DAY' ? (
        <Card className="divide-y divide-border">
          {events.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Nothing scheduled.</p>
          ) : null}
          {events.map((event) => (
            <div key={`${event.kind}${event.id}`} className="flex gap-4 px-4 py-3 text-sm">
              <span className="tabular w-20 shrink-0 text-muted-foreground">
                {time(event.startsAt)}
              </span>
              <div>
                <Link
                  href={event.leadId ? `/dealer/crm/leads/${event.leadId}` : '/dealer/crm/tasks'}
                  className="font-medium hover:underline"
                >
                  {event.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {event.kind === 'APPOINTMENT' ? 'Appointment' : 'Task'} ·{' '}
                  {event.status.toLowerCase().replace(/_/g, ' ')}
                  {event.person ? ` · ${personName(event.person)}` : ''}
                </p>
              </div>
            </div>
          ))}
        </Card>
      ) : (
        <div className="relative overflow-x-auto">
          <div className="grid min-w-[700px] grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <div
                key={day}
                className="bg-secondary/50 px-2 py-1 text-xs font-semibold text-muted-foreground"
              >
                {day}
              </div>
            ))}
            {days.map((day) => {
              const dayEvents = events.filter((event) => sameDay(new Date(event.startsAt), day));
              const outside = mode === 'MONTH' && day.getMonth() !== anchor.getMonth();
              return (
                <div
                  key={day.toISOString()}
                  className={`bg-card p-1.5 ${mode === 'WEEK' ? 'min-h-[220px]' : 'min-h-[96px]'} ${outside ? 'opacity-50' : ''}`}
                >
                  <button
                    type="button"
                    className={`mb-1 rounded px-1 text-xs ${sameDay(day, new Date()) ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}
                    onClick={() => {
                      setAnchor(day);
                      setMode('DAY');
                    }}
                  >
                    {day.getDate()}
                  </button>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, mode === 'MONTH' ? 3 : 12).map((event) => (
                      <Item key={`${event.kind}${event.id}`} event={event} />
                    ))}
                    {dayEvents.length > (mode === 'MONTH' ? 3 : 12) ? (
                      <p className="px-1 text-[11px] text-muted-foreground">
                        +{dayEvents.length - (mode === 'MONTH' ? 3 : 12)} more
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
