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
import { Button, ErrorAlert, Input, Select, Spinner } from '@/components/ui';

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
 * Where a dealer types their own history entries — registrations, sold new,
 * service, safety certificates, accidents — one manually managed timeline.
 *
 * Vintrax does not retrieve anything from CARFAX and does not check these
 * entries; the buyer-facing block says so, and this form says it too, to the
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
    <div className="border-t border-border pt-5">
      <p className="text-sm text-muted-foreground">
        Your own entries — registrations, service, accidents, safety certificates. Vintrax does not
        check these; the listing publishes them as your account of the vehicle.
      </p>

      <ErrorAlert error={vehicle.error ?? save.error} className="mb-4 mt-3" />

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
              type="button"
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
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          disabled={events.length >= MAX_VEHICLE_HISTORY_EVENTS}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Add an entry
        </Button>
        <Button type="button" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
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
    </div>
  );
}
