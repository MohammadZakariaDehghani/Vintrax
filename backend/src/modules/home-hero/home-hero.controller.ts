import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { saveHomeHeroSchema, type HomeHero, type SaveHomeHeroInput } from '@vintrax/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit/audit.service';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { HomeHeroService } from './home-hero.service';

@ApiTags('home-hero')
@Controller()
export class HomeHeroController {
  constructor(
    private readonly hero: HomeHeroService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Get('home-hero')
  @ApiOperation({
    summary: 'The home page hero, when it is switched on',
    description: 'Null while it is a draft: the home page then leads with the newest blog posts.',
  })
  published(): Promise<HomeHero | null> {
    return this.hero.published();
  }

  @Get('admin/home-hero')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'The saved hero, switched on or not' })
  current(): Promise<HomeHero> {
    return this.hero.current();
  }

  @Put('admin/home-hero')
  @RequirePermissions('content:manage')
  @ApiOperation({
    summary: 'Save the home page hero',
    description:
      'Media comes from the library (GET /admin/media). `enabled: false` saves a draft that only the admin preview shows.',
  })
  async save(
    @Body(zodBody(saveHomeHeroSchema)) input: SaveHomeHeroInput,
    @CurrentUser() user: AuthUser,
  ): Promise<HomeHero> {
    const hero = await this.hero.save(input, user.id);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'content.home-hero.saved',
      entityType: 'HomeHero',
      entityId: null,
      metadata: { enabled: hero.enabled },
    });
    return hero;
  }
}
