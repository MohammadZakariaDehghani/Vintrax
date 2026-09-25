import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CarValueModelsQuery,
  type CarValueOption,
  type VehicleValueEstimate,
  type VehicleValueQuery,
  carValueModelsQuerySchema,
  vehicleValueQuerySchema,
} from '@vintrax/shared';
import { Public } from '../../common/decorators';
import { zodQuery } from '../../common/pipes/zod-validation.pipe';
import { CarValueService } from './car-value.service';

/**
 * "Check your car's value". Public: a visitor deciding whether to sell
 * should not need an account to find out what their car is worth.
 */
@ApiTags('car-value')
@Controller('car-value')
export class CarValueController {
  constructor(private readonly carValue: CarValueService) {}

  @Public()
  @Get('makes')
  @ApiOperation({ summary: 'Makes the value tool can estimate, most common first' })
  makes(): Promise<CarValueOption[]> {
    return this.carValue.makes();
  }

  @Public()
  @Get('models')
  @ApiOperation({ summary: "A make's models the value tool can estimate" })
  models(@Query(zodQuery(carValueModelsQuerySchema)) query: CarValueModelsQuery) {
    return this.carValue.models(query.make);
  }

  /** Throttled below the global limit: each call reads up to a few hundred listings. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('estimate')
  @ApiOperation({
    summary: 'Estimate what a car is worth from comparable Vintrax listings',
    description:
      'Adjusts comparable listings of the same make and model to the given year and kilometres. estimate is null when too few comparable cars exist.',
  })
  estimate(
    @Query(zodQuery(vehicleValueQuerySchema)) query: VehicleValueQuery,
  ): Promise<VehicleValueEstimate> {
    return this.carValue.estimate(query);
  }
}
