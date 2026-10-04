import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AccountingPermission } from '@vintrax/shared';
import type { AuthUser } from '../../../common/auth/auth-user';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AccountingAccessService } from './access.service';
import {
  ACCOUNTING_PERMISSIONS_KEY,
  ACCOUNTING_SETUP_ROUTE_KEY,
  type AccountingRequest,
} from './context';

/**
 * Guards every accounting route: resolves the caller's dealership and role,
 * checks the route's accounting permissions, and (except on the setup routes)
 * refuses until the dealer has set accounting up.
 */
@Injectable()
export class AccountingGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccountingAccessService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const required =
      this.reflector.getAllAndOverride<AccountingPermission[]>(
        ACCOUNTING_PERMISSIONS_KEY,
        targets,
      ) ?? [];
    const setupRoute =
      this.reflector.getAllAndOverride<boolean>(ACCOUNTING_SETUP_ROUTE_KEY, targets) ?? false;

    const request = context.switchToHttp().getRequest<AccountingRequest & { user?: AuthUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Authentication required');
    if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
      throw new ForbiddenException('This account cannot use accounting');
    }

    const header = request.headers['x-dealer-id'];
    const accounting = await this.access.resolve(
      user,
      typeof header === 'string' && header.length > 0 ? header : null,
    );

    const missing = required.filter((permission) => !accounting.permissions.has(permission));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing accounting permission: ${missing.join(', ')}`);
    }

    if (!setupRoute) {
      const settings = await this.prisma.accountingSettings.findUnique({
        where: { dealerId: accounting.dealerId },
        select: { dealerId: true },
      });
      if (!settings) {
        throw new ConflictException({
          message: 'Set up accounting for this dealership first',
          code: 'ACCOUNTING_NOT_SET_UP',
        });
      }
    }

    request.accounting = accounting;
    return true;
  }
}
