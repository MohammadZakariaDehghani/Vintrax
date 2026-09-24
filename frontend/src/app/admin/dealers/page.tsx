'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Search, X } from 'lucide-react';
import type { DealerStatus, DealerSummary, Paginated } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatEnum, formatLocation } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  Pagination,
  Spinner,
  Textarea,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';
import {
  BulkOutcomeNote,
  ListToolbar,
  RowCheckbox,
  runBulk,
  usePageSize,
  useRowSelection,
  type BulkOutcome,
} from '@/components/list-controls';

const TABS: Array<{ label: string; status?: DealerStatus }> = [
  { label: 'Pending', status: 'PENDING' },
  { label: 'Verified', status: 'VERIFIED' },
  { label: 'Rejected', status: 'REJECTED' },
  { label: 'Suspended', status: 'SUSPENDED' },
  { label: 'All' },
];

const STATUS_VARIANT: Record<DealerStatus, 'outline' | 'success' | 'warning' | 'destructive'> = {
  PENDING: 'warning',
  VERIFIED: 'success',
  REJECTED: 'destructive',
  SUSPENDED: 'outline',
};

/**
 * Dealer verification.
 *
 * A pending dealership can already list — verification affects the badge and
 * buyer trust, not the ability to trade — so this queue is about the badge.
 * Rejecting takes notes because the applicant is told the outcome.
 */
function DealerQueue() {
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  // Typed, and settled. The query uses the settled value so a request does not
  // go out on every keystroke.
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();
  const [pageSize, setPageSize] = usePageSize('vintrax.admin.dealers.pageSize');
  const [bulkOutcome, setBulkOutcome] = useState<BulkOutcome | null>(null);

  const status = TABS[tab]?.status;
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) query.set('status', status);
  if (search) query.set('q', search);

  const dealers = useQuery({
    queryKey: ['admin-dealers', status ?? 'ALL', page, pageSize, search],
    queryFn: () => api.get<Paginated<DealerSummary>>(`/dealers?${query.toString()}`),
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const verify = useMutation({
    mutationFn: ({ id, approved, note }: { id: string; approved: boolean; note?: string }) =>
      api.patch(`/dealers/${id}/verification`, {
        approved,
        ...(note ? { notes: note } : {}),
      }),
    onSuccess: () => {
      setRejecting(null);
      setNotes('');
      void queryClient.invalidateQueries({ queryKey: ['admin-dealers'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-analytics'] });
    },
  });

  const items = dealers.data?.items ?? [];
  const selection = useRowSelection(
    items.map((dealer) => dealer.id),
    `${tab}:${page}:${pageSize}:${search}`,
  );

  /**
   * Verifying several at once. Only verification, as in moderation: a
   * rejection carries notes the applicant reads, and one note pasted across
   * twenty applications is not feedback.
   */
  const verifyMany = useMutation({
    mutationFn: (ids: string[]) =>
      runBulk(ids, (id) => api.patch(`/dealers/${id}/verification`, { approved: true })),
    onSuccess: (outcome) => {
      setBulkOutcome(outcome);
      selection.clear();
      void queryClient.invalidateQueries({ queryKey: ['admin-dealers'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-analytics'] });
    },
  });

  // The toolbar, page size included, stays reachable when the list is empty
  // or failed to load: the size is remembered, so one the server refused must
  // never leave the page with no way to pick another.
  const toolbar = (
    <ListToolbar
      selection={selection}
      itemCount={items.length}
      pageSize={pageSize}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
      noun="Dealerships"
    >
      <Button
        size="sm"
        loading={verifyMany.isPending}
        onClick={() => {
          setBulkOutcome(null);
          verifyMany.mutate(selection.selectedIds);
        }}
      >
        <Check className="mr-1.5 h-4 w-4" aria-hidden />
        Verify selected
      </Button>
    </ListToolbar>
  );

  return (
    <div className="container py-8">
      <AdminNav />

      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Dealerships</h1>
        <p className="mt-1 text-muted-foreground">
          Verifying a dealership gives it the verified badge on every listing. A pending dealership
          can already sell — verification is about buyer trust, not permission.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap gap-1 border-b border-border" role="tablist">
        {TABS.map((entry, index) => (
          <button
            key={entry.label}
            type="button"
            role="tab"
            aria-selected={index === tab}
            onClick={() => {
              setTab(index);
              setPage(1);
              setRejecting(null);
            }}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              index === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="relative mb-5 w-full sm:w-80">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          className="pl-9"
          placeholder="Search name, city or description"
          aria-label="Search dealerships"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
      </div>

      <ErrorAlert error={dealers.error ?? verify.error ?? verifyMany.error} className="mb-5" />

      {dealers.isPending ? (
        <Spinner label="Loading dealerships" />
      ) : items.length === 0 && dealers.error ? (
        toolbar
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-8 w-8" aria-hidden />}
            title={search ? `Nothing matches "${search}"` : 'Nothing here'}
            description={
              search
                ? 'Searching covers a dealership\u2019s name, city and description.'
                : 'Dealerships appear the moment someone registers one.'
            }
            {...(search
              ? {
                  action: (
                    <Button variant="outline" onClick={() => setSearchText('')}>
                      Clear the search
                    </Button>
                  ),
                }
              : {})}
          />
        </Card>
      ) : (
        <>
          {toolbar}
          {bulkOutcome ? (
            <div className="mb-4">
              <BulkOutcomeNote outcome={bulkOutcome} verb="verified" />
            </div>
          ) : null}
          <ul className="flex flex-col gap-3">
            {items.map((dealer) => (
              <li key={dealer.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-5">
                    <RowCheckbox
                      checked={selection.selected.has(dealer.id)}
                      onChange={(next) => selection.toggle(dealer.id, next)}
                      label={`Select ${dealer.name}`}
                    />
                    <div className="min-w-[220px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/dealers/${dealer.slug}`}
                          className="font-semibold hover:text-primary"
                        >
                          {dealer.name}
                        </Link>
                        <Badge variant={STATUS_VARIANT[dealer.status]}>
                          {formatEnum(dealer.status)}
                        </Badge>
                      </div>
                      {dealer.city && dealer.province ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatLocation(dealer.city, dealer.province)}
                        </p>
                      ) : null}

                      {rejecting === dealer.id ? (
                        <div className="mt-3 max-w-xl">
                          <Field
                            label="Why is this being rejected?"
                            htmlFor={`notes-${dealer.id}`}
                            hint="Kept on the record and sent to the applicant."
                          >
                            <Textarea
                              id={`notes-${dealer.id}`}
                              rows={3}
                              value={notes}
                              onChange={(event) => setNotes(event.target.value)}
                            />
                          </Field>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={!notes.trim() || verify.isPending}
                              onClick={() =>
                                verify.mutate({
                                  id: dealer.id,
                                  approved: false,
                                  note: notes.trim(),
                                })
                              }
                            >
                              Reject the application
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setRejecting(null);
                                setNotes('');
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {dealer.status !== 'VERIFIED' ? (
                            <Button
                              size="sm"
                              loading={verify.isPending}
                              onClick={() => verify.mutate({ id: dealer.id, approved: true })}
                            >
                              <Check className="mr-1.5 h-4 w-4" aria-hidden />
                              Verify
                            </Button>
                          ) : null}
                          {dealer.status !== 'REJECTED' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setRejecting(dealer.id);
                                setNotes('');
                              }}
                            >
                              <X className="mr-1.5 h-4 w-4" aria-hidden />
                              Reject
                            </Button>
                          ) : null}
                          <Link href={`/dealers/${dealer.slug}`}>
                            <Button variant="ghost" size="sm">
                              View profile
                            </Button>
                          </Link>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination
            page={dealers.data!.page}
            totalPages={dealers.data!.totalPages}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}

export default function AdminDealersPage() {
  return (
    <RequireAuth adminOnly>
      <DealerQueue />
    </RequireAuth>
  );
}
