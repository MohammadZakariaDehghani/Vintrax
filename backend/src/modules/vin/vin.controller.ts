import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { VIN_PATTERN, type VinDecodeResult } from '@vintrax/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { VinService } from './vin.service';

const vinParam = z
  .string()
  .trim()
  .toUpperCase()
  .regex(VIN_PATTERN, 'A VIN is 17 letters and digits, without I, O or Q.');

@ApiTags('vehicles')
@Controller('vin')
export class VinController {
  constructor(private readonly vins: VinService) {}

  /** For sellers adding a vehicle; throttled because each miss calls NHTSA. */
  @Get(':vin')
  @RequirePermissions('vehicle:write')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Decode a VIN into make, model, year, trim and drivetrain' })
  decode(@Param('vin', new ZodValidationPipe(vinParam)) vin: string): Promise<VinDecodeResult> {
    return this.vins.decode(vin);
  }
}
