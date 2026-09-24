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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreateHomeFeatureInput,
  type HomeFeature,
  type ReorderHomeFeaturesInput,
  type UpdateHomeFeatureInput,
  createHomeFeatureSchema,
  reorderHomeFeaturesSchema,
  updateHomeFeatureSchema,
} from '@vintrax/shared';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { HomeFeaturesService } from './home-features.service';

@ApiTags('home-features')
@Controller()
export class HomeFeaturesController {
  constructor(
    private readonly features: HomeFeaturesService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Get('home-features')
  @ApiOperation({ summary: 'The feature blocks the home page shows, in order' })
  published(): Promise<HomeFeature[]> {
    return this.features.published();
  }

  @Get('admin/home-features')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Every feature block, hidden ones included' })
  all(): Promise<HomeFeature[]> {
    return this.features.all();
  }

  @Post('admin/home-features')
  @RequirePermissions('content:manage')
  @ApiOperation({
    summary: 'Add a feature block to the bottom of the home page',
    description: 'imageUrl must be a URL returned by POST /uploads/home-features.',
  })
  async create(
    @Body(zodBody(createHomeFeatureSchema)) input: CreateHomeFeatureInput,
    @CurrentUser() user: AuthUser,
  ): Promise<HomeFeature> {
    const feature = await this.features.create(input, user.id);
    await this.record(user, 'content.home-feature.created', feature.id);
    return feature;
  }

  // Declared before `:id` so `order` is not read as an id.
  @Put('admin/home-features/order')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Set the order of the feature blocks, top to bottom' })
  async reorder(
    @Body(zodBody(reorderHomeFeaturesSchema)) input: ReorderHomeFeaturesInput,
    @CurrentUser() user: AuthUser,
  ): Promise<HomeFeature[]> {
    const features = await this.features.reorder(input);
    await this.record(user, 'content.home-feature.reordered', null);
    return features;
  }

  @Patch('admin/home-features/:id')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Edit, show or hide a feature block' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateHomeFeatureSchema)) input: UpdateHomeFeatureInput,
    @CurrentUser() user: AuthUser,
  ): Promise<HomeFeature> {
    const feature = await this.features.update(id, input, user.id);
    await this.record(user, 'content.home-feature.updated', id);
    return feature;
  }

  @Delete('admin/home-features/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Delete a feature block' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.features.remove(id);
    await this.record(user, 'content.home-feature.deleted', id);
  }

  private record(user: AuthUser, action: string, entityId: string | null): Promise<void> {
    return this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action,
      entityType: 'HomeFeature',
      entityId,
      metadata: null,
    });
  }
}
