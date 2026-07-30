import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@atlas/shared';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth-user';

export const IS_PUBLIC_KEY = 'atlas:isPublic';
export const ROLES_KEY = 'atlas:roles';

/**
 * Marks a route as reachable without a token. A valid token is still decoded when
 * present, so public endpoints can personalise their response (favourite flags,
 * owner-only fields) without a second round trip.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to the given roles. Requires authentication. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

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
