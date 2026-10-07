'use client';

import Link from 'next/link';
import { useState, type DragEvent } from 'react';
import { Badge, Dialog, Button, ErrorAlert, Input, Select, Spinner } from '@/components/ui';
import { useCrm } from '@/components/crm/context';
import { PageHeader, TemperatureBadge, useCrmMutation, useCrmQuery } from '@/components/crm/ui';
import { crm, dateTime, personName, qs, type LeadRow, type LeadStatus } from '@/lib/crm';

interface Pipeline {
  columns: Array<{ status: LeadStatus; count: number; leads: LeadRow[] }>;
}

/**
 * The pipeline board. Drag a card to another column (or use its status menu
 * on a phone); every move goes through the same status change as the lead
 * page, so it lands on the timeline and in the audit log.
 */
export default function PipelinePage() {
  const { me } = useCrm();
  const [q, setQ] = useState('');
  const [over, setOver] = useState<string | null>(null);
  const [lost, setLost] = useState<{ leadId: string; statusId: string } | null>(null);
  const [reason, setReason] = useState('');
  const board = useCrmQuery<Pipeline>(['pipeline', q], `/pipeline${qs({ q })}`);
  const move = useCrmMutation((input: { leadId: string; statusId: string; lostReason?: string }) =>
    crm.post(`/leads/${input.leadId}/status`, {
      statusId: input.statusId,
      lostReason: input.lostReason ?? null,
    }),
  );
  const lostStatus = me.statuses.find((status) => status.kind === 'LOST');

  const request = (leadId: string, statusId: string) => {
    const status = me.statuses.find((entry) => entry.id === statusId);
    if (status?.kind === 'LOST') setLost({ leadId, statusId });
    else move.mutate({ leadId, statusId });
  };
  const onDrop = (event: DragEvent, statusId: string) => {
    event.preventDefault();
    setOver(null);
    const leadId = event.dataTransfer.getData('text/plain');
    if (leadId) request(leadId, statusId);
  };

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Drag a lead to move it along. Lost, nurture and unresponsive leads live in the list view."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label="Filter the board"
          placeholder="Filter by name, email, phone…"
          className="max-w-sm"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        {lostStatus ? (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setOver('lost');
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(event) => onDrop(event, lostStatus.id)}
            className={`rounded-md border-2 border-dashed px-4 py-2 text-sm ${over === 'lost' ? 'border-destructive text-destructive' : 'border-border text-muted-foreground'}`}
          >
            Drop here to mark lost
          </div>
        ) : null}
      </div>
      <ErrorAlert error={board.error ?? move.error} className="mb-3" />
      {board.isPending && !board.data ? <Spinner /> : null}
      <div className="relative flex gap-3 overflow-x-auto pb-4">
        {board.data?.columns.map((column) => (
          <section
            key={column.status.id}
            aria-label={column.status.label}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(column.status.id);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(event) => onDrop(event, column.status.id)}
            className={`flex w-64 shrink-0 flex-col rounded-lg border bg-secondary/30 ${over === column.status.id ? 'border-primary' : 'border-border'}`}
          >
            <header className="flex items-center justify-between border-b border-border px-3 py-2">
              <h2 className="text-sm font-semibold">{column.status.label}</h2>
              <Badge variant="outline">{column.count}</Badge>
            </header>
            <ul className="flex-1 space-y-2 p-2">
              {column.leads.map((lead) => (
                <li
                  key={lead.id}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', lead.id)}
                  className="cursor-grab rounded-md border border-border bg-card p-2 text-sm shadow-sm active:cursor-grabbing"
                >
                  <Link
                    href={`/dealer/crm/leads/${lead.id}`}
                    className="font-medium hover:underline"
                  >
                    {personName(lead)}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {lead.vehicle?.title ?? lead.source?.label ?? '—'}
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <TemperatureBadge temperature={lead.temperature} score={lead.score} />
                    <span className="text-[11px] text-muted-foreground">
                      {lead.assignedTo ? personName(lead.assignedTo) : 'Unassigned'}
                    </span>
                  </div>
                  {lead.nextFollowUpAt ? (
                    <p
                      className={`mt-1 text-[11px] ${new Date(lead.nextFollowUpAt) < new Date() ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                      Follow up {dateTime(lead.nextFollowUpAt)}
                    </p>
                  ) : null}
                  <label className="sr-only" htmlFor={`move-${lead.id}`}>
                    Move {personName(lead)}
                  </label>
                  <Select
                    id={`move-${lead.id}`}
                    className="mt-2 h-8 text-xs lg:hidden"
                    value={column.status.id}
                    onChange={(event) => request(lead.id, event.target.value)}
                  >
                    {me.statuses.map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.label}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
              {column.count > column.leads.length ? (
                <li className="px-1 text-xs text-muted-foreground">
                  +{column.count - column.leads.length} more in the list view
                </li>
              ) : null}
            </ul>
          </section>
        ))}
      </div>
      <Dialog
        open={!!lost}
        onClose={() => setLost(null)}
        title="Why was it lost?"
        size="sm"
        footer={
          <Button
            variant="destructive"
            disabled={!reason.trim()}
            onClick={() => {
              if (lost) move.mutate({ ...lost, lostReason: reason.trim() });
              setLost(null);
              setReason('');
            }}
          >
            Mark lost
          </Button>
        }
      >
        <Input
          aria-label="Reason"
          placeholder="Bought elsewhere, price, financing…"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Dialog>
    </>
  );
}
