import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators';
import type { AuthUser } from '../auth/auth-user';

/**
 * Applied globally. Routes marked `@Public()` are allowed through even without a
 * token, but a valid token is still decoded and attached — that is what lets
 * anonymous browsing and personalised browsing share one controller method.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }

  override handleRequest<TUser = AuthUser>(
    err: unknown,
    user: unknown,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (this.isPublic(context)) {
      // Anonymous is fine here; hand back whatever the strategy resolved.
      return (user ?? undefined) as TUser;
    }
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthorizedException('Authentication required');
    }
    return user as TUser;
  }
}
