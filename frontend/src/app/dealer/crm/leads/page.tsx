'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Download, Mail, Phone, Plus, Upload } from 'lucide-react';
import { LEAD_TEMPERATURES, LEAD_VIEWS, type LeadView } from '@vintrax/shared';
import { Button, ErrorAlert, Input, Pagination, Select } from '@/components/ui';
import { useCrm } from '@/components/crm/context';
import { LeadDialog } from '@/components/crm/forms';
import {
  CanCrm,
  DataTable,
  LeadStatusBadge,
  LinkButton,
  PageHeader,
  TemperatureBadge,
  useCrmMutation,
  useCrmQuery,
} from '@/components/crm/ui';
import { crm, dateTime, humanize, personName, qs, type LeadRow, type Paged } from '@/lib/crm';

const VIEW_LABELS: Record<LeadView, string> = {
  ALL: 'All',
  NEW: 'New',
  UNCONTACTED: 'Not contacted',
  FOLLOW_UP_TODAY: 'Follow up today',
  OVERDUE: 'Overdue',
  HOT: 'Hot',
  MINE: 'Mine',
  UNASSIGNED: 'Unassigned',
  WON: 'Won',
  LOST: 'Lost',
};

function LeadsList() {
  const params = useSearchParams();
  const { me, can } = useCrm();
  const initialView = (params.get('view') as LeadView | null) ?? 'ALL';
  const [view, setView] = useState<LeadView>(
    LEAD_VIEWS.includes(initialView) ? initialView : 'ALL',
  );
  const [q, setQ] = useState(params.get('q') ?? '');
  const [statusId, setStatusId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [temperature, setTemperature] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState({ action: '', value: '' });

  const query = qs({
    view,
    q,
    statusId,
    sourceId,
    assignedToId,
    temperature,
    tag,
    sort,
    page,
    pageSize: 25,
  });
  const list = useCrmQuery<Paged<LeadRow>>(['leads', query], `/leads${query}`);
  const bulkRun = useCrmMutation(
    () =>
      crm.post('/leads/bulk', {
        leadIds: [...selected],
        action: bulk.action,
        assignedToId: bulk.action === 'ASSIGN' ? bulk.value || null : null,
        statusId: bulk.action === 'SET_STATUS' ? bulk.value : null,
        tag: bulk.action === 'ADD_TAG' ? bulk.value : null,
      }),
    () => {
      setSelected(new Set());
      setBulk({ action: '', value: '' });
    },
  );
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await crm.save(
        `/leads/export${qs({ view, q, statusId, sourceId, assignedToId, temperature, tag, sort })}`,
        `leads-${new Date().toISOString().slice(0, 10)}.csv`,
      );
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  };
  const rows = list.data?.items;
  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader
        title="Leads"
        description="Everyone who has shown interest, with where they are in the journey and what happens next."
        actions={
          <>
            <CanCrm permission="crm.manage">
              <LinkButton href="/dealer/crm/leads/import">
                <Upload className="h-4 w-4" aria-hidden /> Import
              </LinkButton>
            </CanCrm>
            <CanCrm permission="crm.all_leads">
              <Button variant="outline" loading={exporting} onClick={() => void exportCsv()}>
                <Download className="h-4 w-4" aria-hidden /> Export
              </Button>
            </CanCrm>
            <CanCrm permission="crm.work">
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" aria-hidden /> New lead
              </Button>
            </CanCrm>
          </>
        }
      />
      <ErrorAlert error={exportError} className="mb-3" />
      <div
        className="relative mb-3 flex gap-1 overflow-x-auto border-b border-border"
        role="tablist"
        aria-label="Views"
      >
        {LEAD_VIEWS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={entry === view}
            onClick={() => {
              setView(entry);
              reset();
            }}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${entry === view ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {VIEW_LABELS[entry]}
          </button>
        ))}
      </div>
      <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Input
          type="search"
          aria-label="Search leads"
          placeholder="Name, email, phone, VIN, #"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            reset();
          }}
          className="sm:col-span-3 lg:col-span-2"
        />
        <Select
          aria-label="Status"
          value={statusId}
          onChange={(event) => {
            setStatusId(event.target.value);
            reset();
          }}
        >
          <option value="">All statuses</option>
          {me.statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Source"
          value={sourceId}
          onChange={(event) => {
            setSourceId(event.target.value);
            reset();
          }}
        >
          <option value="">All sources</option>
          {me.sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.label}
            </option>
          ))}
        </Select>
        {can('crm.all_leads') ? (
          <Select
            aria-label="Salesperson"
            value={assignedToId}
            onChange={(event) => {
              setAssignedToId(event.target.value);
              reset();
            }}
          >
            <option value="">Everyone</option>
            <option value="unassigned">Unassigned</option>
            {me.staff.map((person) => (
              <option key={person.id} value={person.id}>
                {personName(person)}
              </option>
            ))}
          </Select>
        ) : null}
        <Select
          aria-label="Temperature"
          value={temperature}
          onChange={(event) => {
            setTemperature(event.target.value);
            reset();
          }}
        >
          <option value="">Any temperature</option>
          {LEAD_TEMPERATURES.map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Tag"
          value={tag}
          onChange={(event) => {
            setTag(event.target.value);
            reset();
          }}
        >
          <option value="">Any tag</option>
          {me.tags.map((entry) => (
            <option key={entry.id} value={entry.name}>
              {entry.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="score">Highest score</option>
          <option value="next_follow_up">Next follow-up</option>
          <option value="last_activity">Recent activity</option>
        </Select>
      </div>

      {selected.size > 0 && can('crm.manage') ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Select
            aria-label="Bulk action"
            className="h-9 w-44"
            value={bulk.action}
            onChange={(event) => setBulk({ action: event.target.value, value: '' })}
          >
            <option value="">Choose an action</option>
            <option value="ASSIGN">Assign to…</option>
            <option value="SET_STATUS">Change status to…</option>
            <option value="ADD_TAG">Add tag…</option>
            <option value="DELETE">Delete</option>
          </Select>
          {bulk.action === 'ASSIGN' ? (
            <Select
              aria-label="Salesperson"
              className="h-9 w-48"
              value={bulk.value}
              onChange={(event) => setBulk({ ...bulk, value: event.target.value })}
            >
              <option value="">Unassigned</option>
              {me.staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {personName(person)}
                </option>
              ))}
            </Select>
          ) : null}
          {bulk.action === 'SET_STATUS' ? (
            <Select
              aria-label="Status"
              className="h-9 w-48"
              value={bulk.value}
              onChange={(event) => setBulk({ ...bulk, value: event.target.value })}
            >
              <option value="">Choose</option>
              {me.statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </Select>
          ) : null}
          {bulk.action === 'ADD_TAG' ? (
            <Input
              aria-label="Tag"
              className="h-9 w-40"
              value={bulk.value}
              onChange={(event) => setBulk({ ...bulk, value: event.target.value })}
            />
          ) : null}
          <Button
            size="sm"
            variant={bulk.action === 'DELETE' ? 'destructive' : 'default'}
            disabled={
              !bulk.action ||
              ((bulk.action === 'SET_STATUS' || bulk.action === 'ADD_TAG') && !bulk.value)
            }
            loading={bulkRun.isPending}
            onClick={() => {
              if (
                bulk.action === 'DELETE' &&
                !window.confirm(`Delete ${selected.size} lead(s)? Their history is deleted too.`)
              )
                return;
              bulkRun.mutate(undefined);
            }}
          >
            Apply
          </Button>
          <ErrorAlert error={bulkRun.error} />
        </div>
      ) : null}

      <DataTable<LeadRow>
        rows={rows}
        loading={list.isPending}
        error={list.error}
        rowKey={(row) => row.id}
        columns={[
          ...(can('crm.manage')
            ? [
                {
                  key: 'select',
                  label: (
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={!!rows?.length && rows.every((row) => selected.has(row.id))}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked ? new Set(rows?.map((row) => row.id)) : new Set(),
                        )
                      }
                    />
                  ),
                  render: (row: LeadRow) => (
                    <input
                      type="checkbox"
                      aria-label={`Select ${personName(row)}`}
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                    />
                  ),
                },
              ]
            : []),
          {
            key: 'name',
            label: 'Lead',
            render: (row) => (
              <div className="min-w-0">
                <Link href={`/dealer/crm/leads/${row.id}`} className="font-medium hover:underline">
                  {personName(row)}
                </Link>
                <span className="ml-1 text-xs text-muted-foreground">#{row.number}</span>
                <div className="flex gap-2 text-xs text-muted-foreground">
                  {row.phone ? (
                    <a
                      href={`tel:${row.phone}`}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      <Phone className="h-3 w-3" aria-hidden />
                      {row.phone}
                    </a>
                  ) : null}
                  {row.email ? (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" aria-hidden />
                      {row.email}
                    </span>
                  ) : null}
                </div>
              </div>
            ),
          },
          {
            key: 'status',
            label: 'Status',
            render: (row) => <LeadStatusBadge status={row.status} />,
          },
          {
            key: 'temp',
            label: 'Score',
            render: (row) => <TemperatureBadge temperature={row.temperature} score={row.score} />,
          },
          {
            key: 'vehicle',
            label: 'Vehicle',
            render: (row) => (
              <span className="text-sm">{row.vehicle?.title ?? row.interestedVin ?? '—'}</span>
            ),
          },
          { key: 'source', label: 'Source', render: (row) => row.source?.label ?? '—' },
          { key: 'assigned', label: 'Salesperson', render: (row) => personName(row.assignedTo) },
          {
            key: 'follow',
            label: 'Next follow-up',
            render: (row) => (
              <span
                className={
                  row.nextFollowUpAt && new Date(row.nextFollowUpAt) < new Date()
                    ? 'font-medium text-destructive'
                    : ''
                }
              >
                {dateTime(row.nextFollowUpAt)}
              </span>
            ),
          },
          { key: 'created', label: 'Created', render: (row) => dateTime(row.createdAt) },
        ]}
      />
      <p className="mt-2 text-sm text-muted-foreground">
        {list.data ? `${list.data.total} lead(s)` : ''}
      </p>
      <Pagination page={page} totalPages={list.data?.totalPages ?? 1} onChange={setPage} />
      <LeadDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

export default function LeadsPage() {
  return (
    <Suspense>
      <LeadsList />
    </Suspense>
  );
}
