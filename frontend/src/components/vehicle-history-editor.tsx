'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Plus, Save, Trash2 } from 'lucide-react';
import {
  MAX_VEHICLE_HISTORY_EVENTS,
  VEHICLE_HISTORY_EVENT_KINDS,
  VEHICLE_HISTORY_EVENT_LABELS,
  type VehicleDetail,
  type VehicleHistoryEventKind,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorAlert,
  Input,
  Select,
  Spinner,
} from '@/components/ui';

/** A row in the editor, with a key that survives reordering and deletion. */
interface EventDraft {
  key: string;
  kind: VehicleHistoryEventKind;
  occurredOn: string;
  label: string;
  detail: string;
}

let nextKey = 0;
const newKey = () => `row-${(nextKey += 1)}`;

/**
 * Where a dealer records what their history report says.
 *
 * The timeline only. A report file used to be uploaded here and kept as a
 * restricted document; issue #34 removed that — a CARFAX report reaches buyers
 * as a link on the listing, and the lines below are the dealer's own summary of
 * it. Removing the upload also removed the one thing that carried a report
 * date, so the buyer-facing block no longer claims one.
 *
 * Vintrax does not retrieve anything from CARFAX and does not check these
 * entries, and the buyer-facing block says so. This form says it too, to the
 * person typing — someone entering "No claims" here should know it is being
 * published as their claim, not ours.
 */
export function VehicleHistoryEditor({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<EventDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  const vehicle = useQuery({
    queryKey: ['vehicle-history', vehicleId],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${vehicleId}`),
  });

  useEffect(() => {
    if (!vehicle.data || loaded) return;
    setEvents(
      vehicle.data.historyEvents.map((event) => ({
        key: newKey(),
        kind: event.kind,
        occurredOn: event.occurredOn ?? '',
        label: event.label,
        detail: event.detail ?? '',
      })),
    );
    setLoaded(true);
  }, [vehicle.data, loaded]);

  const save = useMutation({
    mutationFn: () =>
      api.put<VehicleDetail>(`/vehicles/${vehicleId}/history`, {
        events: events
          // A row with no label says nothing, so it is dropped rather than
          // rejected — a dealer who added a row and changed their mind should
          // not have to find it again to save the others.
          .filter((event) => event.label.trim().length > 0)
          .map((event) => ({
            kind: event.kind,
            label: event.label.trim(),
            ...(event.occurredOn ? { occurredOn: event.occurredOn } : {}),
            ...(event.detail.trim() ? { detail: event.detail.trim() } : {}),
          })),
      }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['vehicle-history', vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ['vehicle-documents', vehicleId] });
    },
  });

  function update(key: string, patch: Partial<EventDraft>) {
    setSaved(false);
    setEvents((current) =>
      current.map((event) => (event.key === key ? { ...event, ...patch } : event)),
    );
  }

  function addRow() {
    setSaved(false);
    setEvents((current) => [
      ...current,
      { key: newKey(), kind: 'SERVICE', occurredOn: '', label: '', detail: '' },
    ]);
  }

  if (vehicle.isPending) return <Spinner label="Loading the vehicle history" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vehicle history</CardTitle>
        <CardDescription>
          List the entries from the vehicle&rsquo;s history report that buyers should see. Vintrax
          does not retrieve or check reports — the timeline is published as your account of the
          vehicle. To link the report itself, put its CARFAX address in the{' '}
          <strong>CARFAX report link</strong> field above; buyers get a badge that opens it.
          <br />
          <br />
          Start with the report&rsquo;s <strong>Accident / Damage Record</strong>. Add one{' '}
          <strong>Accident / damage</strong> entry per record it lists, with the date and the repair
          estimate in the detail — those are pulled out and shown above the timeline, because it is
          the first thing a buyer looks for. If the report states no accidents, say so with a{' '}
          <strong>No accidents reported</strong> entry: leaving it out reads as nothing having been
          checked, which is not what your report says.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ErrorAlert error={vehicle.error ?? save.error} className="mb-4" />

        <div className="flex flex-col gap-3">
          {events.map((event) => (
            <div key={event.key} className="grid gap-3 sm:grid-cols-[10rem_9rem_1fr_1fr_auto]">
              <Select
                value={event.kind}
                aria-label="What happened"
                onChange={(changed) =>
                  update(event.key, { kind: changed.target.value as VehicleHistoryEventKind })
                }
              >
                {VEHICLE_HISTORY_EVENT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {VEHICLE_HISTORY_EVENT_LABELS[kind]}
                  </option>
                ))}
              </Select>
              <Input
                type="date"
                aria-label="When"
                value={event.occurredOn}
                onChange={(changed) => update(event.key, { occurredOn: changed.target.value })}
              />
              <Input
                aria-label="Entry"
                placeholder="Damage reported"
                maxLength={80}
                value={event.label}
                onChange={(changed) => update(event.key, { label: changed.target.value })}
              />
              <Input
                aria-label="Detail"
                placeholder="$4,200 estimate — rear"
                maxLength={160}
                value={event.detail}
                onChange={(changed) => update(event.key, { detail: changed.target.value })}
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label="Remove this entry"
                onClick={() => {
                  setSaved(false);
                  setEvents((current) => current.filter((row) => row.key !== event.key));
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={addRow}
            disabled={events.length >= MAX_VEHICLE_HISTORY_EVENTS}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Add an entry
          </Button>
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            <Save className="mr-2 h-4 w-4" aria-hidden />
            Save timeline
          </Button>
          {saved ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
          {events.length === 0 ? (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <FileUp className="h-4 w-4" aria-hidden />
              Nothing is shown on the listing until you add an entry.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
