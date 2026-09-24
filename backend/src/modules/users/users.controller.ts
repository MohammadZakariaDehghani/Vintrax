import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type Address,
  type AddressInput,
  type AdminCreateUserInput,
  type AdminSetPasswordInput,
  type Paginated,
  type PublicUser,
  type UpdateProfileInput,
  type UpdateUserRoleInput,
  type UpdateUserStatusInput,
  MAX_PAGE_SIZE,
  addressSchema,
  adminCreateUserSchema,
  adminSetPasswordSchema,
  updateProfileSchema,
  updateUserRoleSchema,
  updateUserStatusSchema,
} from '@vintrax/shared';
import { z } from 'zod';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { UsersService } from './users.service';

/** Up to the server-wide 100, the largest page size the admin Users list offers. */
export const listUsersQuerySchema = z.object({
  role: z.string().optional(),
  status: z.string().optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});

@ApiTags('users')
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch('me')
  @ApiOperation({ summary: "Update the caller's profile" })
  updateProfile(
    @Body(zodBody(updateProfileSchema)) body: UpdateProfileInput,
    @CurrentUser() user: AuthUser,
  ): Promise<PublicUser> {
    return this.users.updateProfile(user.id, body);
  }

  @Get('me/addresses')
  @ApiOperation({ summary: "List the caller's saved addresses" })
  listAddresses(@CurrentUser() user: AuthUser): Promise<Address[]> {
    return this.users.listAddresses(user.id);
  }

  @Post('me/addresses')
  @ApiOperation({ summary: 'Save an address' })
  createAddress(
    @Body(zodBody(addressSchema)) body: AddressInput,
    @CurrentUser() user: AuthUser,
  ): Promise<Address> {
    return this.users.createAddress(user.id, body);
  }

  @Delete('me/addresses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a saved address' })
  async deleteAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.users.deleteAddress(user.id, id);
  }

  @Get('admin/users')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: 'List platform users' })
  listUsers(
    @Query(zodQuery(listUsersQuerySchema)) query: z.infer<typeof listUsersQuerySchema>,
  ): Promise<Paginated<PublicUser>> {
    return this.users.listUsers(query.page, query.pageSize, {
      role: query.role,
      status: query.status,
      q: query.q,
    });
  }

  @Get('admin/users/:id')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: 'Read one account' })
  getUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<PublicUser> {
    return this.users.getUserAsAdmin(id, actor);
  }

  @Post('admin/users')
  @RequirePermissions('user:manage')
  @Audit('user.created_by_admin', 'User')
  @ApiOperation({ summary: 'Create an account and assign its role' })
  createUser(
    @Body(zodBody(adminCreateUserSchema)) body: AdminCreateUserInput,
    @CurrentUser() actor: AuthUser,
  ): Promise<PublicUser> {
    return this.users.createUser(body, actor);
  }

  @Patch('admin/users/:id/role')
  @RequirePermissions('user:manage')
  @Audit('user.role_changed', 'User')
  @ApiOperation({ summary: "Change an account's role" })
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateUserRoleSchema)) body: UpdateUserRoleInput,
    @CurrentUser() actor: AuthUser,
  ): Promise<PublicUser> {
    return this.users.updateRole(id, body, actor);
  }

  @Patch('admin/users/:id/password')
  @RequirePermissions('user:manage')
  // No @Audit here: the service writes the entry itself, because the reason is
  // in the body and the interceptor never sees it. Annotating as well would put
  // two rows in the trail for one action.
  @ApiOperation({ summary: "Set an account's password" })
  setPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(adminSetPasswordSchema)) body: AdminSetPasswordInput,
    @CurrentUser() actor: AuthUser,
  ): Promise<PublicUser> {
    return this.users.setPassword(id, body, actor);
  }

  @Patch('admin/users/:id/status')
  @RequirePermissions('user:manage')
  @Audit('user.status_changed', 'User')
  @ApiOperation({ summary: 'Suspend, reactivate or deactivate an account' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateUserStatusSchema)) body: UpdateUserStatusInput,
    @CurrentUser() actor: AuthUser,
  ): Promise<PublicUser> {
    return this.users.updateStatus(id, body, actor);
  }
}
