import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import type { User } from '../../../generated/prisma/client';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import { RequestLocale } from '../../localization/request-locale.decorator';
import {
  ContentListQueryDto,
  CreateContentBlockDto,
  CreateContentPageDto,
  UpdateContentBlockDto,
  UpdateContentPageDto,
} from '../dto/content.dto';
import { ContentManagementService } from '../services/content-management.service';

@ApiTags('29 Content Management')
@Controller('content/home')
export class PublicHomepageContentController {
  constructor(private readonly content: ContentManagementService) {}

  @Get('services') @Throttle({ default: { limit: 60, ttl: 60_000 } }) services(@RequestLocale() locale: string) { return this.content.homepageServices(locale); }
  @Get('popular-projects') @Throttle({ default: { limit: 60, ttl: 60_000 } }) popularProjects(@RequestLocale() locale: string) { return this.content.homepagePopularProjects(locale); }
  @Get('recommended-jobs') @Throttle({ default: { limit: 60, ttl: 60_000 } }) recommendedJobs(@RequestLocale() locale: string) { return this.content.homepageRecommendedJobs(locale); }
  @Get('testimonials') @Throttle({ default: { limit: 60, ttl: 60_000 } }) testimonials(@RequestLocale() locale: string) { return this.content.homepageTestimonials(locale); }
  @Get('how-it-works') @Throttle({ default: { limit: 60, ttl: 60_000 } }) howItWorks(@RequestLocale() locale: string) { return this.content.homepageManagedBlock('how_it_works', locale); }
  @Get('social') @Throttle({ default: { limit: 60, ttl: 60_000 } }) social(@RequestLocale() locale: string) { return this.content.homepageManagedBlock('social_links', locale); }
}

@ApiTags('29 Content Management')
@Controller('content')
export class ContentManagementController {
  constructor(private readonly content: ContentManagementService) {}

  @Get(':slug')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiParam({ name: 'slug', required: true, type: String, description: 'Content page slug.' })
  @ApiOperation({ summary: 'Get one published localized content page' })
  publicPage(@Param('slug') slug: string, @RequestLocale() locale: string) {
    return this.content.publicPage(slug, locale);
  }
}

@ApiTags('29 Admin - Content Management')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/content')
export class AdminContentManagementController {
  constructor(private readonly content: ContentManagementService) {}

  @Get()
  @Permissions('content.read')
  @ApiOperation({ summary: 'List managed content pages' })
  list(@Query() query: ContentListQueryDto) {
    return this.content.adminList(query);
  }

  @Get(':id')
  @Permissions('content.read')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Content page ID.' })
  @ApiOperation({ summary: 'Get one managed content page with all blocks and translations' })
  get(@Param('id') id: string) {
    return this.content.adminGet(id);
  }

  @Post()
  @Permissions('content.manage')
  @ApiOperation({ summary: 'Create a managed content page' })
  create(@CurrentUser() actor: User, @Body() dto: CreateContentPageDto) {
    return this.content.create(actor, dto);
  }

  @Patch(':id')
  @Permissions('content.manage')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Content page ID.' })
  @ApiOperation({ summary: 'Update a managed content page' })
  update(@CurrentUser() actor: User, @Param('id') id: string, @Body() dto: UpdateContentPageDto) {
    return this.content.update(actor, id, dto);
  }

  @Delete(':id')
  @Permissions('content.manage')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Content page ID.' })
  @ApiOperation({ summary: 'Permanently delete an unpublished content page' })
  delete(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.content.deletePage(actor, id);
  }

  @Post(':id/publish')
  @Permissions('content.manage')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Content page ID.' })
  @ApiOperation({ summary: 'Publish a content page' })
  publish(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.content.publish(actor, id);
  }

  @Post(':id/unpublish')
  @Permissions('content.manage')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Content page ID.' })
  @ApiOperation({ summary: 'Unpublish a content page' })
  unpublish(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.content.unpublish(actor, id);
  }

  @Post(':id/blocks')
  @Permissions('content.manage')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Content page ID.' })
  @ApiOperation({ summary: 'Add a content block to a page' })
  createBlock(@CurrentUser() actor: User, @Param('id') id: string, @Body() dto: CreateContentBlockDto) {
    return this.content.createBlock(actor, id, dto);
  }

  @Patch(':id/blocks/:blockId')
  @Permissions('content.manage')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Content page ID.' })
  @ApiParam({ name: 'blockId', required: true, type: String, description: 'Content block ID.' })
  @ApiOperation({ summary: 'Update a content block' })
  updateBlock(@CurrentUser() actor: User, @Param('id') id: string, @Param('blockId') blockId: string, @Body() dto: UpdateContentBlockDto) {
    return this.content.updateBlock(actor, id, blockId, dto);
  }

  @Delete(':id/blocks/:blockId')
  @Permissions('content.manage')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Content page ID.' })
  @ApiParam({ name: 'blockId', required: true, type: String, description: 'Content block ID.' })
  @ApiOperation({ summary: 'Delete a content block' })
  deleteBlock(@CurrentUser() actor: User, @Param('id') id: string, @Param('blockId') blockId: string) {
    return this.content.deleteBlock(actor, id, blockId);
  }
}
