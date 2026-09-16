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
  Field,
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
 * Two separate things, on purpose. The **report** is a document: it is uploaded
 * like any other paperwork and stays restricted, because a CARFAX report
 * carries the previous owner's name and address and the full VIN history. The
 * **timeline** is a handful of lines the dealer transcribes from it, which name
 * nobody and are shown to buyers.
 *
 * Vintrax does not retrieve anything from CARFAX and does not check these
 * entries, and the buyer-facing block says so. This form says it too, to the
 * person typing — someone entering "No claims" here should know it is being
 * published as their claim, not ours.
 */
export function VehicleHistoryEditor({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<EventDraft[]>([]);
  const [reportDate, setReportDate] = useState('');
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
    setReportDate(vehicle.data.historyReportIssuedOn ?? '');
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

  /**
   * Uploads the report and attaches it to the vehicle.
   *
   * Two calls: the file goes to storage, then its URL is attached as a
   * document. The vehicle PATCH replaces the document set wholesale, so the
   * existing documents are sent back with the new one rather than being
   * dropped.
   */
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const stored = await api.upload<{ url: string; sizeBytes: number }>(
        '/uploads/documents',
        file,
      );
      const current = await api.get<VehicleDetail>(`/vehicles/${vehicleId}`);
      return api.patch<VehicleDetail>(`/vehicles/${vehicleId}`, {
        documents: [
          ...current.documents.map((document) => ({
            type: document.type,
            url: document.url,
            filename: document.filename,
            ...(document.sizeBytes ? { sizeBytes: document.sizeBytes } : {}),
            ...(document.issuedOn ? { issuedOn: document.issuedOn } : {}),
          })),
          {
            type: 'CARFAX' as const,
            url: stored.url,
            filename: file.name,
            sizeBytes: stored.sizeBytes,
            ...(reportDate ? { issuedOn: reportDate } : {}),
          },
        ],
      });
    },
    onSuccess: () => {
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

  const reports = (vehicle.data?.documents ?? []).filter((document) => document.type === 'CARFAX');

  if (vehicle.isPending) return <Spinner label="Loading the vehicle history" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vehicle history</CardTitle>
        <CardDescription>
          Upload the history report you hold, then list the entries from it that buyers should see.
          Vintrax does not retrieve or check reports — the timeline is published as your account of
          the vehicle, and the report stays private to you, administrators and a buyer with a live
          order.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ErrorAlert error={vehicle.error ?? save.error ?? upload.error} className="mb-4" />

        <div className="mb-6 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">History report</p>

          {reports.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
              {reports.map((report) => (
                <li key={report.id}>
                  {report.filename}
                  {report.issuedOn ? ` · dated ${report.issuedOn}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Nothing uploaded yet.</p>
          )}

          <div className="mt-3 grid gap-3 sm:max-w-md">
            <Field
              label="Date on the report"
              htmlFor="report-date"
              hint="Shown to buyers so they can judge how current the timeline is. The report itself is not."
            >
              <Input
                id="report-date"
                type="date"
                value={reportDate}
                onChange={(event) => setReportDate(event.target.value)}
              />
            </Field>

            <label className="flex flex-col items-start gap-2 text-sm">
              <span className="font-medium">Upload a PDF</span>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:opacity-90"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) upload.mutate(file);
                  event.target.value = '';
                }}
              />
            </label>
            {upload.isPending ? <Spinner label="Uploading" /> : null}
          </div>
        </div>

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
                placeholder="Sold new"
                maxLength={80}
                value={event.label}
                onChange={(changed) => update(event.key, { label: changed.target.value })}
              />
              <Input
                aria-label="Detail"
                placeholder="Toronto, ON"
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
