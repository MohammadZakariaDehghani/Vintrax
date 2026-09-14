import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission, UserRole } from '@vintrax/shared';
import type { Request } from 'express';
import { PERMISSIONS_KEY, ROLES_KEY, VERIFIED_EMAIL_KEY } from '../decorators';
import { hasPermission, type AuthUser } from '../auth/auth-user';

/**
 * Enforces `@Roles`, `@RequirePermissions` and `@RequireVerifiedEmail`.
 *
 * Roles are coarse — "may this kind of account do this kind of thing".
 * Permissions are the finer check and the one to prefer. Row-level ownership
 * ("may this account touch this row") stays in the services, which are the only
 * layer that can see the data.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      targets,
    );
    const requiresVerifiedEmail =
      this.reflector.getAllAndOverride<boolean>(VERIFIED_EMAIL_KEY, targets) ?? false;

    const nothingRequired =
      !requiredRoles?.length && !requiredPermissions?.length && !requiresVerifiedEmail;
    if (nothingRequired) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Authentication required');

    // A suspended account keeps its token until expiry, so status is checked
    // on every protected request rather than only at login.
    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('This account is suspended');
    }
    if (user.status === 'DEACTIVATED') {
      throw new ForbiddenException('This account has been deactivated');
    }

    if (requiresVerifiedEmail && !user.emailVerified) {
      throw new ForbiddenException('Verify your email address before performing this action');
    }

    // No blanket administrator bypass. ROLE_PERMISSIONS is the only answer to
    // "may this account do this", so the matrix and the runtime agree.
    //
    // There used to be an `isAdmin(user.role) return true` here, and it quietly
    // contradicted the matrix: ADMIN is deliberately not given `settings:manage`
    // — the comment on that permission says platform configuration stays with
    // super admins — but the bypass granted it anyway. Once an administrator can
    // change another account's role, a bypass like this is the difference
    // between "an admin may not create a super admin" and "an admin may do
    // anything it likes, including promote itself".
    //
    // Two permissions change hands by removing it, both back to what the matrix
    // already said: `settings:manage` (the search reindex) and `bid:place`,
    // which an admin should not hold anyway — the operator of a marketplace
    // does not bid in it.

    if (requiredRoles?.length && !requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `This action requires one of the following roles: ${requiredRoles.join(', ')}`,
      );
    }

    if (requiredPermissions?.length) {
      const missing = requiredPermissions.filter(
        (permission) => !hasPermission(user.role, permission),
      );
      if (missing.length) {
        throw new ForbiddenException(`Missing required permission: ${missing.join(', ')}`);
      }
    }

    return true;
  }
}
