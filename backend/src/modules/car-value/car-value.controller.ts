import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CarValueModelsQuery,
  type CarValueOption,
  type SimilarCars,
  type SimilarCarsQuery,
  type VehicleValueEstimate,
  type VehicleValueQuery,
  carValueModelsQuerySchema,
  similarCarsQuerySchema,
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

  /** Throttled below the global limit, like the estimate: each call ranks every match. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('similar')
  @ApiOperation({
    summary: 'Cars for sale like the given one, closest match first',
    description:
      'Every public listing of that make, with a model starting with the given one, within three model years. Trim and mileageKm only change the order.',
  })
  similar(@Query(zodQuery(similarCarsQuerySchema)) query: SimilarCarsQuery): Promise<SimilarCars> {
    return this.carValue.similar(query);
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
