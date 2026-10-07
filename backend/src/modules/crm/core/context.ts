import {
  createParamDecorator,
  ForbiddenException,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import {
  CRM_ROLE_PERMISSIONS,
  type CrmPermission,
  type DealerStaffRole,
} from '@vintrax/shared';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';

/**
 * Who is working which dealership's CRM. Built on the server from the session
 * (never from anything the client sends) and passed to every CRM service
 * call, which filters every query by `dealerId`.
 */
export interface CrmContext {
  dealerId: string;
  /** The account that owns the dealership; its vehicles are the inventory. */
  ownerUserId: string;
  userId: string;
  actorEmail: string;
  role: DealerStaffRole;
  permissions: ReadonlySet<CrmPermission>;
  /** Set when an automation or an inbound event acts, not a person. */
  system?: boolean;
}

export const CRM_PERMISSIONS_KEY = 'vintrax:crmPermissions';

/** The caller needs every one of these CRM permissions. */
export const RequireCrm = (...permissions: CrmPermission[]) =>
  SetMetadata(CRM_PERMISSIONS_KEY, permissions);

export type CrmRequest = Request & { crm?: CrmContext };

/** Injects the resolved context. Only valid behind `CrmGuard`. */
export const Crm = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<CrmRequest>();
  if (!request.crm) throw new Error('CrmGuard did not run for this route');
  return request.crm;
});

export function can(ctx: CrmContext, permission: CrmPermission): boolean {
  return ctx.permissions.has(permission);
}

export function assertCrm(ctx: CrmContext, permission: CrmPermission): void {
  if (!ctx.permissions.has(permission)) {
    throw new ForbiddenException(`Missing CRM permission: ${permission}`);
  }
}

/**
 * Which leads the caller sees. Managers see every lead of the dealership; a
 * salesperson sees the leads assigned to them and the unassigned pool, so a
 * new lead can be picked up, but never a colleague's.
 */
export function leadScope(ctx: CrmContext): Prisma.CrmLeadWhereInput {
  const base: Prisma.CrmLeadWhereInput = { dealerId: ctx.dealerId, mergedIntoId: null };
  if (ctx.permissions.has('crm.all_leads')) return base;
  return { ...base, OR: [{ assignedToId: ctx.userId }, { assignedToId: null }] };
}

/** The context for a known dealership, user and role (seeding, tests, jobs). */
export function crmContextFor(
  dealerId: string,
  ownerUserId: string,
  userId: string,
  email: string,
  role: DealerStaffRole,
): CrmContext {
  return {
    dealerId,
    ownerUserId,
    userId,
    actorEmail: email,
    role,
    permissions: new Set(CRM_ROLE_PERMISSIONS[role]),
  };
}

/** The system acting for a dealership (automations, inbound events). */
export function systemContext(dealerId: string, ownerUserId: string): CrmContext {
  return {
    dealerId,
    ownerUserId,
    userId: ownerUserId,
    actorEmail: 'system',
    role: 'OWNER',
    permissions: new Set(CRM_ROLE_PERMISSIONS.OWNER),
    system: true,
  };
}
