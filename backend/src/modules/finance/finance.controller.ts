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
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  financeApplicationInputSchema,
  financeApplicationQuerySchema,
  financeSettingsSchema,
  updateFinanceApplicationSchema,
  type FinanceApplicationDetail,
  type FinanceApplicationInput,
  type FinanceApplicationPage,
  type FinanceApplicationQuery,
  type FinanceSettings,
  type FinanceSettingsInput,
  type UpdateFinanceApplicationInput,
  type VehicleFinanceOptions,
} from '@vintrax/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { FinanceService } from './finance.service';

/**
 * Finance applications.
 *
 * Buyers apply from a listing: any signed-in account may, as any signed-in
 * account may message a seller. Sellers manage what they received under the
 * dealer portal's `dealer/` prefix with `vehicle:write`, the permission every
 * inventory route uses; the service scopes each of those to the caller.
 */
@ApiTags('finance')
@Controller()
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('vehicles/:vehicleId/finance-options')
  @ApiOperation({ summary: 'Whether this listing takes finance applications from you' })
  options(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<VehicleFinanceOptions> {
    return this.finance.optionsFor(vehicleId, user);
  }

  @Post('vehicles/:vehicleId/finance-applications')
  // An application is a few minutes of typing; more than a handful a minute
  // from one address is a script.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Send the vehicle's seller a finance application" })
  apply(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body(zodBody(financeApplicationInputSchema)) input: FinanceApplicationInput,
    @CurrentUser() user: AuthUser,
  ): Promise<{ id: string }> {
    return this.finance.apply(vehicleId, input, user);
  }

  @Get('dealer/finance-applications')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: 'Finance applications for your listings' })
  list(
    @CurrentUser() user: AuthUser,
    @Query(zodQuery(financeApplicationQuerySchema)) query: FinanceApplicationQuery,
  ): Promise<FinanceApplicationPage> {
    return this.finance.list(user, query);
  }

  @Get('dealer/finance-applications/:id')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: 'One finance application, in full' })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<FinanceApplicationDetail> {
    return this.finance.detail(id, user);
  }

  @Patch('dealer/finance-applications/:id')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: 'Change the status of an application or your notes on it' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateFinanceApplicationSchema)) input: UpdateFinanceApplicationInput,
    @CurrentUser() user: AuthUser,
  ): Promise<FinanceApplicationDetail> {
    return this.finance.update(id, input, user);
  }

  @Delete('dealer/finance-applications/:id')
  @RequirePermissions('vehicle:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an application and the personal details in it' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.finance.remove(id, user);
  }

  @Get('dealer/finance-settings')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: 'Where new finance applications are sent' })
  settings(@CurrentUser() user: AuthUser): Promise<FinanceSettings> {
    return this.finance.settings(user);
  }

  @Put('dealer/finance-settings')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: 'Change where new finance applications are sent' })
  updateSettings(
    @Body(zodBody(financeSettingsSchema)) input: FinanceSettingsInput,
    @CurrentUser() user: AuthUser,
  ): Promise<FinanceSettings> {
    return this.finance.updateSettings(input, user);
  }
}
