import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@atlas/shared';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators';
import type { AuthUser } from '../auth/auth-user';

/** Enforces `@Roles(...)`. ADMIN satisfies every role requirement. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Authentication required');
    if (user.role === 'ADMIN') return true;

    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        `This action requires one of the following roles: ${required.join(', ')}`,
      );
    }
    return true;
  }
}
