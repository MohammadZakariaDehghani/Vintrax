import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission, UserRole } from '@vintrax/shared';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth-user';

export const IS_PUBLIC_KEY = 'vintrax:isPublic';
export const ROLES_KEY = 'vintrax:roles';
export const PERMISSIONS_KEY = 'vintrax:permissions';
export const AUDIT_KEY = 'vintrax:audit';
export const VERIFIED_EMAIL_KEY = 'vintrax:verifiedEmail';

/**
 * Marks a route as reachable without a token. A valid token is still decoded
 * when present, so public endpoints can personalise their response (favourite
 * flags, owner-only fields) without a second round trip.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to the given roles. Admin roles always satisfy this. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Restricts a route to callers holding every listed permission. Prefer this
 * over `@Roles` — it survives the addition of new roles.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Requires a verified email address. Applied to actions with financial or
 * reputational consequence, such as bidding and publishing.
 */
export const RequireVerifiedEmail = () => SetMetadata(VERIFIED_EMAIL_KEY, true);

/**
 * Records the route's effect in the audit log. `entityType` names the subject;
 * the id is read from the route's `:id` parameter when present.
 */
export const Audit = (action: string, entityType: string) =>
  SetMetadata(AUDIT_KEY, { action, entityType });

/**
 * Injects the authenticated user. On `@Public()` routes this is `undefined`
 * when the caller is anonymous, so the parameter type is `AuthUser | undefined`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return request.user;
  },
);

/** Injects the correlation id assigned to this request. */
export const RequestId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request & { requestId?: string }>();
  return request.requestId ?? 'unknown';
});

/** Injects the caller's IP, honouring the proxy headers set by a load balancer. */
export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return request.ip ?? 'unknown';
});
