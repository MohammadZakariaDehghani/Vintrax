import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BODY_TYPES,
  type AdminAnalytics,
  type AuditLogEntry,
  type AuditLogQuery,
  type BodyType,
  type BodyTypeImage,
  type BodyTypeImageInput,
  type CreatePartnerInput,
  type FooterSection,
  type MakeLogo,
  type MakeLogoInput,
  type Paginated,
  type Partner,
  type ReplaceFooterInput,
  type UpdatePartnerInput,
  auditLogQuerySchema,
  bodyTypeImageSchema,
  createPartnerSchema,
  makeLogoSchema,
  replaceFooterSchema,
  updatePartnerSchema,
} from '@vintrax/shared';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AdminService } from './admin.service';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
  ) {}

  @Get('analytics')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'Platform-wide metrics for the admin dashboard' })
  analytics(): Promise<AdminAnalytics> {
    return this.admin.analytics();
  }

  @Get('audit-logs')
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Query the audit trail' })
  auditLogs(
    @Query(zodQuery(auditLogQuerySchema)) query: AuditLogQuery,
  ): Promise<Paginated<AuditLogEntry>> {
    return this.audit.query(query);
  }

  /**
   * The photographs behind the home page's body-type shortcuts.
   *
   * Public, because the home page renders for signed-out visitors and this is
   * the picture they are about to look at. It carries no more than what the
   * page already shows.
   */
  @Public()
  @Get('body-type-images')
  @ApiOperation({ summary: 'Body-type shortcut photographs, as shown on the home page' })
  bodyTypeImages(): Promise<BodyTypeImage[]> {
    return this.admin.publicBodyTypeImages();
  }

  @Put('body-type-images/:bodyType')
  @RequirePermissions('content:manage')
  @ApiOperation({
    summary: 'Set the photograph for one body-type shortcut',
    description:
      'The URL must be one returned by POST /uploads/body-type-images. Upserted on the body type, so saving twice replaces rather than duplicates.',
  })
  async setBodyTypeImage(
    @Param('bodyType') bodyType: string,
    @Body(zodBody(bodyTypeImageSchema)) input: BodyTypeImageInput,
    @CurrentUser() user: AuthUser,
  ): Promise<BodyTypeImage> {
    const parsed = parseBodyType(bodyType);
    const result = await this.admin.setBodyTypeImage(parsed, input, user.id);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'content.body-type-image.set',
      entityType: 'BodyTypeImage',
      entityId: null,
      metadata: { bodyType: parsed, imageUrl: result.imageUrl },
    });
    return result;
  }

  @Delete('body-type-images/:bodyType')
  @RequirePermissions('content:manage')
  @ApiOperation({
    summary: 'Remove the photograph for one body-type shortcut',
    description: 'The shortcut falls back to a photo from live inventory, then to a silhouette.',
  })
  async clearBodyTypeImage(
    @Param('bodyType') bodyType: string,
    @CurrentUser() user: AuthUser,
  ): Promise<BodyTypeImage> {
    const parsed = parseBodyType(bodyType);
    const result = await this.admin.clearBodyTypeImage(parsed);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'content.body-type-image.clear',
      entityType: 'BodyTypeImage',
      entityId: null,
      metadata: { bodyType: parsed },
    });
    return result;
  }

  /**
   * The site footer: "About us", "Resources", "Partners", "Stay in touch" by
   * default, and whatever an administrator has since made of them.
   *
   * Public for the same reason the body-type photographs are: the footer
   * renders on every page for every visitor, signed in or not.
   */
  @Public()
  @Get('footer')
  @ApiOperation({ summary: 'The site footer, as shown on every page' })
  footer(): Promise<FooterSection[]> {
    return this.admin.publicFooter();
  }

  @Put('footer')
  @RequirePermissions('content:manage')
  @ApiOperation({
    summary: 'Replace the whole site footer',
    description:
      'The caller sends every section it wants kept, each with its own ordered links; ' +
      'anything left out is gone. Matches how a vehicle history timeline is saved.',
  })
  async replaceFooter(
    @Body(zodBody(replaceFooterSchema)) body: ReplaceFooterInput,
    @CurrentUser() user: AuthUser,
  ): Promise<FooterSection[]> {
    const result = await this.admin.replaceFooter(body, user.id);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'content.footer.replaced',
      entityType: 'FooterSection',
      entityId: null,
      metadata: {
        sectionCount: result.length,
        linkCount: result.reduce((total, section) => total + section.links.length, 0),
      },
    });
    return result;
  }

  /**
   * Logos an administrator has set for a vehicle make, overriding the
   * generated mark the home page's popular-makes row otherwise draws.
   *
   * Public for the same reason the body-type photographs are: the popular
   * makes row renders for every visitor, signed in or not.
   */
  @Public()
  @Get('make-logos')
  @ApiOperation({ summary: 'Logos set for vehicle makes, as shown on the home page' })
  makeLogos(): Promise<MakeLogo[]> {
    return this.admin.publicMakeLogos();
  }

  @Put('make-logos/:make')
  @RequirePermissions('content:manage')
  @ApiOperation({
    summary: "Set the logo for one vehicle make",
    description:
      'The URL must be one returned by POST /uploads/make-logos. Upserted on the make, ' +
      'matched case-insensitively, so saving twice replaces rather than duplicates.',
  })
  async setMakeLogo(
    @Param('make') make: string,
    @Body(zodBody(makeLogoSchema)) input: MakeLogoInput,
    @CurrentUser() user: AuthUser,
  ): Promise<MakeLogo> {
    const result = await this.admin.setMakeLogo(make, input, user.id);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'content.make-logo.set',
      entityType: 'MakeLogo',
      entityId: null,
      metadata: { make: result.make, imageUrl: result.imageUrl },
    });
    return result;
  }

  @Delete('make-logos/:make')
  @RequirePermissions('content:manage')
  @ApiOperation({
    summary: 'Remove the logo for one vehicle make',
    description: 'The popular-makes row falls back to its generated mark for that make.',
  })
  async clearMakeLogo(
    @Param('make') make: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ make: string }> {
    await this.admin.clearMakeLogo(make);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'content.make-logo.clear',
      entityType: 'MakeLogo',
      entityId: null,
      metadata: { make },
    });
    return { make };
  }

  /**
   * Every partner, enabled or not — public the same way the footer and
   * make-logos reads are, so the homepage's carousel renders for every
   * visitor, signed in or not. The admin partners page reads the same
   * endpoint and shows every row; the homepage filters to `enabled` itself.
   */
  @Public()
  @Get('partners')
  @ApiOperation({ summary: 'Partner logos, as shown in the home page carousel' })
  partners(): Promise<Partner[]> {
    return this.admin.publicPartners();
  }

  @Post('partners')
  @RequirePermissions('content:manage')
  @ApiOperation({
    summary: 'Add a partner logo',
    description: 'The URL must be one returned by POST /uploads/partners.',
  })
  async createPartner(
    @Body(zodBody(createPartnerSchema)) input: CreatePartnerInput,
    @CurrentUser() user: AuthUser,
  ): Promise<Partner> {
    const result = await this.admin.createPartner(input, user.id);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'content.partner.created',
      entityType: 'Partner',
      entityId: result.id,
      metadata: { name: result.name },
    });
    return result;
  }

  @Put('partners/:id')
  @RequirePermissions('content:manage')
  @ApiOperation({
    summary: 'Update a partner — its name, logo, or whether it shows on the home page',
    description: 'A replacement logo URL must be one returned by POST /uploads/partners.',
  })
  async updatePartner(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updatePartnerSchema)) input: UpdatePartnerInput,
    @CurrentUser() user: AuthUser,
  ): Promise<Partner> {
    const result = await this.admin.updatePartner(id, input, user.id);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'content.partner.updated',
      entityType: 'Partner',
      entityId: result.id,
      metadata: { name: result.name, enabled: result.enabled },
    });
    return result;
  }

  @Delete('partners/:id')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Remove a partner outright' })
  async deletePartner(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ id: string }> {
    await this.admin.deletePartner(id);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'content.partner.deleted',
      entityType: 'Partner',
      entityId: id,
      metadata: {},
    });
    return { id };
  }
}

/**
 * A path segment is a string until something says otherwise. Checked against
 * the enum rather than cast, so an unknown body type is a 400 naming the valid
 * ones instead of a row keyed on nonsense.
 */
function parseBodyType(value: string): BodyType {
  const match = BODY_TYPES.find((bodyType) => bodyType === value.toUpperCase());
  if (!match) {
    throw new BadRequestException(
      `Unknown body type "${value}". Expected one of: ${BODY_TYPES.join(', ')}`,
    );
  }
  return match;
}
