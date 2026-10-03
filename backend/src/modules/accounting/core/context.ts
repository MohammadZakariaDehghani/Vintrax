import {
  createParamDecorator,
  ForbiddenException,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import { STAFF_ROLE_PERMISSIONS, type AccountingPermission, type DealerStaffRole } from '@vintrax/shared';
import type { Request } from 'express';

/**
 * Who is acting on which dealer's books. Built on the server from the
 * session — never from anything the client sends — and passed to every
 * accounting service call, which filters every query by `dealerId`.
 */
export interface AccountingContext {
  dealerId: string;
  /** The account that owns the dealership; its vehicles are the inventory. */
  ownerUserId: string;
  userId: string;
  actorEmail: string;
  role: DealerStaffRole;
  permissions: ReadonlySet<AccountingPermission>;
}

export const ACCOUNTING_PERMISSIONS_KEY = 'vintrax:accountingPermissions';
export const ACCOUNTING_SETUP_ROUTE_KEY = 'vintrax:accountingSetupRoute';

/** The caller needs every one of these accounting permissions. */
export const RequireAccounting = (...permissions: AccountingPermission[]) =>
  SetMetadata(ACCOUNTING_PERMISSIONS_KEY, permissions);

/** Reachable before the dealer has set accounting up (status and setup). */
export const AccountingSetupRoute = () => SetMetadata(ACCOUNTING_SETUP_ROUTE_KEY, true);

export type AccountingRequest = Request & { accounting?: AccountingContext };

/** Injects the resolved context. Only valid behind `AccountingGuard`. */
export const Acct = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AccountingRequest>();
  if (!request.accounting) throw new Error('AccountingGuard did not run for this route');
  return request.accounting;
});

export function can(ctx: AccountingContext, permission: AccountingPermission): boolean {
  return ctx.permissions.has(permission);
}

/** For a permission that depends on the request (e.g. posting straight away). */
export function assertPermission(ctx: AccountingContext, permission: AccountingPermission): void {
  if (!ctx.permissions.has(permission)) {
    throw new ForbiddenException(`Missing accounting permission: ${permission}`);
  }
}

/** The context for a known dealership, user and role (seeding, tests, jobs). */
export function contextFor(
  dealerId: string,
  ownerUserId: string,
  userId: string,
  email: string,
  role: DealerStaffRole,
): AccountingContext {
  return {
    dealerId,
    ownerUserId,
    userId,
    actorEmail: email,
    role,
    permissions: new Set(STAFF_ROLE_PERMISSIONS[role]),
  };
}
