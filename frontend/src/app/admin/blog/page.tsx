'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PenLine, Plus, Trash2 } from 'lucide-react';
import type { ArticleStatus, ArticleSummary, Paginated } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorAlert,
  Pagination,
  Spinner,
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

const STATUS_VARIANT: Record<ArticleStatus, 'success' | 'warning' | 'outline'> = {
  PUBLISHED: 'success',
  DRAFT: 'warning',
  ARCHIVED: 'outline',
};

const STATUS_LABEL: Record<ArticleStatus, string> = {
  PUBLISHED: 'Published',
  DRAFT: 'Draft',
  ARCHIVED: 'Archived',
};

/** How many of the newest posts the home page banner rotates through. */
const BANNER_SIZE = 5;

type BulkAction = 'publish' | 'unpublish' | 'delete';

const BULK_VERB: Record<BulkAction, string> = {
  publish: 'published',
  unpublish: 'moved to drafts',
  delete: 'deleted',
};

/**
 * The editorial desk.
 *
 * Ordered by when each post was last edited rather than by publication date,
 * because the thing an author is looking for is what they were working on.
 */
function ArticleList() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('vintrax.admin.blog.pageSize');
  const [bulkOutcome, setBulkOutcome] = useState<{ verb: string; outcome: BulkOutcome } | null>(
    null,
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const articles = useQuery({
    queryKey: ['admin-articles', page, pageSize],
    queryFn: () =>
      api.get<Paginated<ArticleSummary>>(`/admin/articles?page=${page}&pageSize=${pageSize}`),
  });

  // The banner is the newest published posts, whichever page of this list
  // they happen to fall on, so it is asked for directly.
  const banner = useQuery({
    queryKey: ['articles', 'banner'],
    queryFn: () => api.get<Paginated<ArticleSummary>>(`/articles?pageSize=${BANNER_SIZE}`),
  });
  const onBanner = new Set((banner.data?.items ?? []).map((post) => post.id));

  const items = articles.data?.items ?? [];
  const selection = useRowSelection(
    items.map((article) => article.id),
    `${page}:${pageSize}`,
  );

  const bulk = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: BulkAction }) =>
      runBulk(ids, (id) =>
        action === 'delete'
          ? api.delete(`/admin/articles/${id}`)
          : api.patch(`/admin/articles/${id}`, {
              status: action === 'publish' ? 'PUBLISHED' : 'DRAFT',
            }),
      ),
    onSuccess: (outcome, variables) => {
      setBulkOutcome({ verb: BULK_VERB[variables.action], outcome });
      setConfirmingDelete(false);
      selection.clear();
      void queryClient.invalidateQueries({ queryKey: ['admin-articles'] });
      void queryClient.invalidateQueries({ queryKey: ['articles'] });
    },
  });

  function run(action: BulkAction) {
    setBulkOutcome(null);
    bulk.mutate({ ids: selection.selectedIds, action });
  }

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Blog</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The {BANNER_SIZE} most recently published posts rotate in the banner across the top of
            the home page. Everything else lives at{' '}
            <span className="font-medium text-foreground">/blog</span>.
          </p>
        </div>
        <Link href="/admin/blog/new">
          <Button>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Write a post
          </Button>
        </Link>
      </header>

      <ErrorAlert error={articles.error ?? bulk.error} className="mb-4" />

      {articles.isLoading ? (
        <Spinner label="Loading posts" />
      ) : articles.data && items.length > 0 ? (
        <>
          <ListToolbar
            selection={selection}
            itemCount={items.length}
            pageSize={pageSize}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            noun="Posts"
          >
            <Button
              size="sm"
              loading={bulk.isPending && bulk.variables?.action === 'publish'}
              disabled={bulk.isPending}
              onClick={() => run('publish')}
            >
              Publish
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={bulk.isPending && bulk.variables?.action === 'unpublish'}
              disabled={bulk.isPending}
              onClick={() => run('unpublish')}
            >
              Unpublish
            </Button>
            {confirmingDelete ? (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  loading={bulk.isPending && bulk.variables?.action === 'delete'}
                  disabled={bulk.isPending}
                  onClick={() => run('delete')}
                >
                  Yes, delete {selection.selectedIds.length}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={bulk.isPending}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
                Delete
              </Button>
            )}
          </ListToolbar>
          {bulkOutcome ? (
            <div className="mb-4">
              <BulkOutcomeNote outcome={bulkOutcome.outcome} verb={bulkOutcome.verb} />
            </div>
          ) : null}

          <ul className="space-y-3">
            {items.map((article) => (
              <li key={article.id} className="flex items-start gap-3">
                <RowCheckbox
                  checked={selection.selected.has(article.id)}
                  onChange={(next) => selection.toggle(article.id, next)}
                  label={`Select ${article.title}`}
                />
                <Link href={`/admin/blog/${article.slug}`} className="group block min-w-0 flex-1">
                  <Card className="overflow-hidden transition-colors group-hover:border-primary/40">
                    <CardContent className="flex flex-col gap-4 p-4 sm:flex-row">
                      <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden rounded bg-muted sm:h-[86px] sm:w-[152px]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={article.heroImageUrl ?? undefined}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <Badge variant={STATUS_VARIANT[article.status]}>
                            {STATUS_LABEL[article.status]}
                          </Badge>
                          {onBanner.has(article.id) ? (
                            <Badge variant="outline">On the home banner</Badge>
                          ) : null}
                        </div>
                        <h2 className="truncate font-semibold">{article.title}</h2>
                        {article.subtitle ? (
                          <p className="truncate text-sm text-muted-foreground">
                            {article.subtitle}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-muted-foreground">
                          Edited{' '}
                          {new Date(article.updatedAt).toLocaleDateString('en-CA', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                          {article.authorName ? ` · ${article.authorName}` : ''}
                        </p>
                      </div>
                      <PenLine
                        className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground sm:block"
                        aria-hidden
                      />
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination
            page={articles.data.page}
            totalPages={articles.data.totalPages}
            onChange={setPage}
          />
        </>
      ) : (
        <EmptyState
          title="No posts yet"
          description="Write one and the home page leads with it."
          action={
            <Link href="/admin/blog/new">
              <Button>Write a post</Button>
            </Link>
          }
        />
      )}
    </>
  );
}

export default function AdminBlogPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <ArticleList />
      </div>
    </RequireAuth>
  );
}
