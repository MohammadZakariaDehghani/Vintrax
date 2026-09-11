import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type Article,
  type ArticleInput,
  type ArticleQuery,
  type ArticleSummary,
  type Paginated,
  type UpdateArticleInput,
  articleQuerySchema,
  articleSchema,
  updateArticleSchema,
} from '@vintrax/shared';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { ArticlesService } from './articles.service';

/**
 * Editorial posts, as a visitor sees them.
 *
 * Everything here is public and shows published posts only. The admin routes
 * live on a separate controller rather than behind a query flag on these, so
 * there is no path where forgetting a check turns a reader into an editor.
 */
@ApiTags('articles')
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  /**
   * Declared before `:slug`, or a request for /articles/masthead is read as a
   * post whose slug is "masthead".
   */
  @Public()
  @Get('masthead')
  @ApiOperation({ summary: 'The post the home page leads with, or null' })
  masthead(): Promise<ArticleSummary | null> {
    return this.articles.masthead();
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Published posts, newest first' })
  list(
    @Query(zodQuery(articleQuerySchema)) query: ArticleQuery,
  ): Promise<Paginated<ArticleSummary>> {
    return this.articles.list(query);
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'One published post' })
  findOne(@Param('slug') slug: string): Promise<Article> {
    return this.articles.findBySlug(slug);
  }
}

/**
 * Authoring. Every route needs `content:manage`, the same permission that
 * governs the body-type photographs — both are the storefront's presentation
 * rather than the platform's configuration.
 */
@ApiTags('articles')
@Controller('admin/articles')
export class AdminArticlesController {
  constructor(
    private readonly articles: ArticlesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'All posts including drafts, most recently edited first' })
  list(
    @Query(zodQuery(articleQuerySchema)) query: ArticleQuery,
  ): Promise<Paginated<ArticleSummary>> {
    return this.articles.list(query, { includeUnpublished: true });
  }

  @Get(':slug')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'One post, published or not' })
  findOne(@Param('slug') slug: string): Promise<Article> {
    return this.articles.findBySlug(slug, { includeUnpublished: true });
  }

  @Post()
  @RequirePermissions('content:manage')
  @ApiOperation({
    summary: 'Write a post',
    description:
      'The hero image must be a URL returned by POST /uploads/article-images. The slug is derived from the title.',
  })
  async create(
    @Body(zodBody(articleSchema)) input: ArticleInput,
    @CurrentUser() user: AuthUser,
  ): Promise<Article> {
    const article = await this.articles.create(input, user.id);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'content.article.created',
      entityType: 'Article',
      entityId: article.id,
      metadata: { slug: article.slug, status: article.status },
    });
    return article;
  }

  @Patch(':id')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Edit a post, or publish and unpublish it' })
  async update(
    @Param('id') id: string,
    @Body(zodBody(updateArticleSchema)) input: UpdateArticleInput,
    @CurrentUser() user: AuthUser,
  ): Promise<Article> {
    const article = await this.articles.update(id, input);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'content.article.updated',
      entityType: 'Article',
      entityId: article.id,
      metadata: { slug: article.slug, status: article.status },
    });
    return article;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:manage')
  @ApiOperation({
    summary: 'Delete a post',
    description: 'Archiving hides a post without losing the writing; this removes it.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.articles.remove(id);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'content.article.deleted',
      entityType: 'Article',
      entityId: id,
      metadata: null,
    });
  }
}
