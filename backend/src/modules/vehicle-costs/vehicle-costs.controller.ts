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
  costOverviewQuerySchema,
  updateVehicleCostSchema,
  vehicleCostInputSchema,
  type CostOverviewPage,
  type CostOverviewQuery,
  type UpdateVehicleCostInput,
  type VehicleCostBreakdown,
  type VehicleCostEntry,
  type VehicleCostInput,
} from '@vintrax/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { VehicleCostsService } from './vehicle-costs.service';

/**
 * Vehicle costs, under the dealer portal's `dealer/` prefix.
 *
 * `vehicle:write` is the gate, as for every other inventory route: whoever may
 * list and edit a vehicle may record what it cost them. The service then scopes
 * every query to the caller's own vehicles — a permission says what kind of
 * thing an account may do, never whose rows it may do it to.
 */
@ApiTags('vehicle-costs')
@Controller('dealer')
export class VehicleCostsController {
  constructor(private readonly costs: VehicleCostsService) {}

  @Get('costs')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: 'Cost overview across your inventory, with totals and gross margin' })
  overview(
    @CurrentUser() user: AuthUser,
    @Query(zodQuery(costOverviewQuerySchema)) query: CostOverviewQuery,
  ): Promise<CostOverviewPage> {
    return this.costs.overview(user, query);
  }

  @Get('inventory/:vehicleId/costs')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: "One of your vehicles' cost breakdown" })
  breakdown(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<VehicleCostBreakdown> {
    return this.costs.breakdown(vehicleId, user);
  }

  @Post('inventory/:vehicleId/costs')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: 'Record a cost against one of your vehicles' })
  add(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body(zodBody(vehicleCostInputSchema)) input: VehicleCostInput,
    @CurrentUser() user: AuthUser,
  ): Promise<VehicleCostEntry> {
    return this.costs.add(vehicleId, input, user);
  }

  @Patch('costs/:costId')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: 'Change a recorded cost' })
  update(
    @Param('costId', ParseUUIDPipe) costId: string,
    @Body(zodBody(updateVehicleCostSchema)) input: UpdateVehicleCostInput,
    @CurrentUser() user: AuthUser,
  ): Promise<VehicleCostEntry> {
    return this.costs.update(costId, input, user);
  }

  @Delete('costs/:costId')
  @RequirePermissions('vehicle:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a recorded cost' })
  async remove(
    @Param('costId', ParseUUIDPipe) costId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.costs.remove(costId, user);
  }
}
