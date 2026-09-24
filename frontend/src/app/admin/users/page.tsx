'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Users } from 'lucide-react';
import type {
  AdminCreateUserInput,
  AdminSetPasswordInput,
  Paginated,
  PublicUser,
  UserRole,
  UserStatus,
} from '@vintrax/shared';
import { USER_ROLES, USER_STATUSES, assignableRoles, canAdministerUser } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { useUser } from '@/store/auth-store';
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
import { CreateUserPanel } from './create-user-panel';
import { SetPasswordPanel } from './set-password-panel';
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
  // Which row has its password form open, and the last one that succeeded.
  // One at a time: two open forms is two chances to reset the wrong account.
  const [passwordFor, setPasswordFor] = useState<string | null>(null);
  const [passwordDone, setPasswordDone] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const me = useUser();

  // The same two rules the server enforces, used here only to avoid offering a
  // control that would be refused. The server decides; this just keeps the page
  // honest about what it is offering.
  const canAssign = me ? assignableRoles(me.role) : [];
  const [pageSize, setPageSize] = usePageSize('vintrax.admin.users.pageSize');
  const [bulkOutcome, setBulkOutcome] = useState<{ verb: string; outcome: BulkOutcome } | null>(
    null,
  );

  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (role) query.set('role', role);
  if (status) query.set('status', status);
  if (term) query.set('q', term);

  const users = useQuery({
    queryKey: ['admin-users', role, status, term, page, pageSize],
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

  const changeRole = useMutation({
    mutationFn: ({ id, role: next }: { id: string; role: UserRole }) =>
      api.patch<PublicUser>(`/admin/users/${id}/role`, { role: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  const setPassword = useMutation({
    mutationFn: ({ id, input }: { id: string; input: AdminSetPasswordInput }) =>
      api.patch<PublicUser>(`/admin/users/${id}/password`, input),
    onSuccess: (_result, variables) => {
      setPasswordFor(null);
      setPasswordDone(variables.id);
      // The account itself is unchanged, but its sessions are gone; nothing in
      // this list shows that, so there is no query to invalidate.
    },
  });

  const createUser = useMutation({
    mutationFn: (input: AdminCreateUserInput) => api.post<PublicUser>('/admin/users', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-analytics'] });
    },
  });

  const items = users.data?.items ?? [];
  // Only rows this administrator may act on can be ticked: their own account
  // and accounts at or above their role would only come back as refusals.
  const selectableIds = items
    .filter((user) => !!me && me.id !== user.id && canAdministerUser(me.role, user.role))
    .map((user) => user.id);
  const selection = useRowSelection(selectableIds, `${role}:${status}:${term}:${page}:${pageSize}`);

  const changeStatusMany = useMutation({
    mutationFn: ({ ids, next }: { ids: string[]; next: UserStatus; verb: string }) =>
      runBulk(ids, (id) => api.patch(`/admin/users/${id}/status`, { status: next })),
    onSuccess: (outcome, variables) => {
      setBulkOutcome({ verb: variables.verb, outcome });
      selection.clear();
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-analytics'] });
    },
  });

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

      {canAssign.length > 0 ? (
        <CreateUserPanel
          assignableRoles={canAssign}
          pending={createUser.isPending}
          error={createUser.error}
          onSubmit={(input) => createUser.mutateAsync(input)}
        />
      ) : null}

      <ErrorAlert
        error={users.error ?? changeStatus.error ?? changeRole.error ?? changeStatusMany.error}
        className="mb-5"
      />

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
          <ListToolbar
            selection={selection}
            itemCount={selectableIds.length}
            pageSize={pageSize}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            noun="Users"
          >
            <Button
              size="sm"
              loading={changeStatusMany.isPending && changeStatusMany.variables?.next === 'ACTIVE'}
              disabled={changeStatusMany.isPending}
              onClick={() => {
                setBulkOutcome(null);
                changeStatusMany.mutate({
                  ids: selection.selectedIds,
                  next: 'ACTIVE',
                  verb: 'activated',
                });
              }}
            >
              Activate
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={
                changeStatusMany.isPending && changeStatusMany.variables?.next === 'SUSPENDED'
              }
              disabled={changeStatusMany.isPending}
              onClick={() => {
                setBulkOutcome(null);
                changeStatusMany.mutate({
                  ids: selection.selectedIds,
                  next: 'SUSPENDED',
                  verb: 'suspended',
                });
              }}
            >
              Suspend
            </Button>
          </ListToolbar>
          {bulkOutcome ? (
            <div className="mb-4">
              <BulkOutcomeNote outcome={bulkOutcome.outcome} verb={bulkOutcome.verb} />
            </div>
          ) : null}
          <ul className="flex flex-col gap-3">
            {items.map((user) => {
              // Your own row offers nothing: the server refuses a self role
              // change, a self suspension and a self password set, so showing
              // the controls would only produce a 403.
              const isSelf = me?.id === user.id;
              const mayAdminister = !!me && !isSelf && canAdministerUser(me.role, user.role);

              return (
                <li key={user.id}>
                  <Card>
                    <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-5">
                      {mayAdminister ? (
                        <RowCheckbox
                          checked={selection.selected.has(user.id)}
                          onChange={(next) => selection.toggle(user.id, next)}
                          label={`Select ${user.displayName}`}
                        />
                      ) : (
                        <span className="w-4 shrink-0" aria-hidden />
                      )}
                      <div className="min-w-[220px] flex-1">
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

                      <div className="flex flex-wrap items-center gap-2">
                        {!mayAdminister ? (
                          isSelf ? (
                            <span className="text-sm text-muted-foreground">
                              This is your account
                            </span>
                          ) : null
                        ) : (
                          <>
                            <Select
                              aria-label={`Role for ${user.displayName}`}
                              className="h-9 w-[150px]"
                              value={user.role}
                              disabled={changeRole.isPending}
                              onChange={(event) =>
                                changeRole.mutate({
                                  id: user.id,
                                  role: event.target.value as UserRole,
                                })
                              }
                            >
                              {/* The current role is always listed, even when it
                                  is one this administrator could not assign, so
                                  the control shows the truth rather than an
                                  arbitrary first option. */}
                              {(canAssign.includes(user.role)
                                ? canAssign
                                : [user.role, ...canAssign]
                              ).map((entry) => (
                                <option key={entry} value={entry}>
                                  {formatEnum(entry)}
                                </option>
                              ))}
                            </Select>
                            {(NEXT_STATUS[user.status] ?? []).map((action) => (
                              <Button
                                key={action.status}
                                variant={action.status === 'ACTIVE' ? 'default' : 'outline'}
                                size="sm"
                                loading={changeStatus.isPending}
                                onClick={() =>
                                  changeStatus.mutate({ id: user.id, next: action.status })
                                }
                              >
                                {action.label}
                              </Button>
                            ))}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                // Reset rather than toggle blindly: a failure
                                // left over from the last account would
                                // otherwise greet the next one.
                                setPassword.reset();
                                setPasswordDone(null);
                                setPasswordFor((open) => (open === user.id ? null : user.id));
                              }}
                              aria-expanded={passwordFor === user.id}
                            >
                              <KeyRound className="mr-1.5 h-4 w-4" aria-hidden />
                              {passwordFor === user.id ? 'Close' : 'Set password'}
                            </Button>
                          </>
                        )}
                        {user.dealer ? (
                          <Link href={`/dealers/${user.dealer.slug}`}>
                            <Button variant="ghost" size="sm">
                              Dealership
                            </Button>
                          </Link>
                        ) : null}
                      </div>

                      {passwordFor === user.id ? (
                        <div className="w-full">
                          <SetPasswordPanel
                            displayName={user.displayName}
                            pending={setPassword.isPending}
                            error={setPassword.error}
                            onSubmit={(input) => setPassword.mutateAsync({ id: user.id, input })}
                            onCancel={() => setPasswordFor(null)}
                          />
                        </div>
                      ) : passwordDone === user.id ? (
                        <p className="w-full text-sm text-success" role="status">
                          Password set. {user.displayName} has been signed out everywhere and will
                          need the new password to sign back in.
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
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
