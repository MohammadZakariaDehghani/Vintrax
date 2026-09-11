import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreateInspectionInput,
  type InspectionDetail,
  type Paginated,
  type SubmitInspectionInput,
  createInspectionSchema,
  submitInspectionSchema,
} from '@vintrax/shared';
import { z } from 'zod';
import { Audit, CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { InspectionsService } from './inspections.service';

const listQuerySchema = z.object({
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(20),
});

@ApiTags('inspections')
@Controller('inspections')
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  // Declared before ':id' so the literal segment is not captured as a UUID.
  @Get('mine')
  @RequirePermissions('inspection:write')
  @ApiOperation({ summary: "Return the calling inspector's assignments" })
  listMine(
    @Query(zodQuery(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
    @CurrentUser() inspector: AuthUser,
  ): Promise<Paginated<InspectionDetail>> {
    return this.inspections.listMine(inspector, query.page, query.pageSize, query.status);
  }

  @Public()
  @Get('vehicle/:vehicleId')
  @ApiOperation({ summary: 'Return the completed inspection report for a vehicle' })
  findForVehicle(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
  ): Promise<InspectionDetail | null> {
    return this.inspections.findForVehicle(vehicleId);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Return an inspection report' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() viewer?: AuthUser,
  ): Promise<InspectionDetail> {
    return this.inspections.findById(id, viewer);
  }

  @Post()
  @RequirePermissions('inspection:write')
  @Audit('inspection.scheduled', 'VehicleInspection')
  @ApiOperation({ summary: 'Schedule an inspection and assign it to the caller' })
  create(
    @Body(zodBody(createInspectionSchema)) body: CreateInspectionInput,
    @CurrentUser() inspector: AuthUser,
  ): Promise<InspectionDetail> {
    return this.inspections.create(body, inspector);
  }

  @Post(':id/submit')
  @RequirePermissions('inspection:write')
  @Audit('inspection.submitted', 'VehicleInspection')
  @ApiOperation({ summary: 'Submit a completed inspection report' })
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(submitInspectionSchema)) body: SubmitInspectionInput,
    @CurrentUser() inspector: AuthUser,
  ): Promise<InspectionDetail> {
    return this.inspections.submit(id, body, inspector);
  }
}
