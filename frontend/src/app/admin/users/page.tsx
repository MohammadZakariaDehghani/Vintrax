'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import type { Paginated, PublicUser, UserStatus } from '@vintrax/shared';
import { USER_ROLES, USER_STATUSES } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatDate, formatEnum } from '@/lib/utils';
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
  Select,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';

const STATUS_VARIANT: Record<UserStatus, 'outline' | 'success' | 'warning' | 'destructive'> = {
  PENDING: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'destructive',
  DEACTIVATED: 'outline',
};

/** What an administrator can do to an account in each state. */
const NEXT_STATUS: Partial<Record<UserStatus, Array<{ status: UserStatus; label: string }>>> = {
  PENDING: [{ status: 'ACTIVE', label: 'Activate' }],
  ACTIVE: [{ status: 'SUSPENDED', label: 'Suspend' }],
  SUSPENDED: [
    { status: 'ACTIVE', label: 'Reinstate' },
    { status: 'DEACTIVATED', label: 'Deactivate' },
  ],
  DEACTIVATED: [{ status: 'ACTIVE', label: 'Reactivate' }],
};

function UserDirectory() {
  const [page, setPage] = useState(1);
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const queryClient = useQueryClient();

  const query = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (role) query.set('role', role);
  if (status) query.set('status', status);
  if (term) query.set('q', term);

  const users = useQuery({
    queryKey: ['admin-users', role, status, term, page],
    queryFn: () => api.get<Paginated<PublicUser>>(`/admin/users?${query.toString()}`),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: UserStatus }) =>
      api.patch<PublicUser>(`/admin/users/${id}/status`, { status: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-analytics'] });
    },
  });

  const items = users.data?.items ?? [];

  return (
    <div className="container py-8">
      <AdminNav />

      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Users</h1>
        <p className="mt-1 text-muted-foreground">
          Suspending an account revokes its live sessions immediately — the next request it makes is
          rejected, rather than waiting for a token to expire.
        </p>
      </div>

      <form
        className="mb-5 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setTerm(search.trim());
          setPage(1);
        }}
      >
        <Field label="Search" htmlFor="q" className="min-w-[220px] flex-1">
          <Input
            id="q"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or email"
          />
        </Field>
        <Field label="Role" htmlFor="role">
          <Select
            id="role"
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Any role</option>
            {USER_ROLES.map((entry) => (
              <option key={entry} value={entry}>
                {formatEnum(entry)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="status">
          <Select
            id="status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Any status</option>
            {USER_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {formatEnum(entry)}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <ErrorAlert error={users.error ?? changeStatus.error} className="mb-5" />

      {users.isPending ? (
        <Spinner label="Loading users" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="h-8 w-8" aria-hidden />}
            title="No accounts match"
            description="Try a broader search, or clear the role and status filters."
          />
        </Card>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {items.map((user) => (
              <li key={user.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-5">
                    <div className="min-w-[220px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{user.displayName}</p>
                        <Badge variant={STATUS_VARIANT[user.status]}>
                          {formatEnum(user.status)}
                        </Badge>
                        <Badge variant="outline">{formatEnum(user.role)}</Badge>
                        {!user.emailVerified ? (
                          <Badge variant="warning">Email unverified</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {user.dealer ? `${user.dealer.name} · ` : ''}
                        Joined {formatDate(user.createdAt)}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {(NEXT_STATUS[user.status] ?? []).map((action) => (
                        <Button
                          key={action.status}
                          variant={action.status === 'ACTIVE' ? 'default' : 'outline'}
                          size="sm"
                          loading={changeStatus.isPending}
                          onClick={() => changeStatus.mutate({ id: user.id, next: action.status })}
                        >
                          {action.label}
                        </Button>
                      ))}
                      {user.dealer ? (
                        <Link href={`/dealers/${user.dealer.slug}`}>
                          <Button variant="ghost" size="sm">
                            Dealership
                          </Button>
                        </Link>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination
            page={users.data!.page}
            totalPages={users.data!.totalPages}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <RequireAuth adminOnly>
      <UserDirectory />
    </RequireAuth>
  );
}
