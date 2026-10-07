import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CrmPermission } from '@vintrax/shared';
import type { AuthUser } from '../../../common/auth/auth-user';
import { CrmAccessService } from './access.service';
import { CrmSetupService } from './setup.service';
import { CRM_PERMISSIONS_KEY, type CrmRequest } from './context';

/**
 * Guards every Dealer CRM route: resolves the caller's dealership and role,
 * checks the route's CRM permissions, and makes sure the dealership's CRM
 * defaults (statuses, sources, templates, automations) exist.
 */
@Injectable()
export class CrmGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: CrmAccessService,
    private readonly setup: CrmSetupService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<CrmPermission[]>(CRM_PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const request = context.switchToHttp().getRequest<CrmRequest & { user?: AuthUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Authentication required');
    if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
      throw new ForbiddenException('This account cannot use the CRM');
    }

    const header = request.headers['x-dealer-id'];
    const crm = await this.access.resolve(
      user,
      typeof header === 'string' && header.length > 0 ? header : null,
    );
    const missing = required.filter((permission) => !crm.permissions.has(permission));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing CRM permission: ${missing.join(', ')}`);
    }

    await this.setup.ensure(crm.dealerId);
    request.crm = crm;
    return true;
  }
}
