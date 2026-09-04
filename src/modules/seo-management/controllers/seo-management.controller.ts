import { Controller, Delete, Get, Header, Param, Patch, Post, Query, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import type { User } from '../../../generated/prisma/client';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import { SeoManagementService } from '../services/seo-management.service';
import { SeoPageListQueryDto, SeoRedirectDto, SeoResolveQueryDto, SeoSitemapEntryDto, SeoSettingsDto, UpsertSeoPageDto } from '../dto/seo.dto';

@ApiTags('20 SEO')
@Controller('seo')
export class SeoPublicController {
  constructor(private readonly seo: SeoManagementService) {}
  @Get('meta') @Throttle({ default: { limit: 60, ttl: 60_000 } }) @ApiOperation({ summary: 'Resolve localized SEO metadata for a public route' }) meta(@Query() query: SeoResolveQueryDto) { return this.seo.publicMeta(query); }
  @Get('sitemap.xml') @Throttle({ default: { limit: 20, ttl: 60_000 } }) @Header('Content-Type', 'application/xml; charset=utf-8') @ApiOperation({ summary: 'Generate the authoritative XML sitemap' }) sitemap() { return this.seo.sitemap(); }
  @Get('robots.txt') @Throttle({ default: { limit: 20, ttl: 60_000 } }) @Header('Content-Type', 'text/plain; charset=utf-8') @ApiOperation({ summary: 'Generate robots.txt from managed SEO rules' }) robots() { return this.seo.robots(); }
}

@ApiTags('63 Admin - SEO')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/seo')
export class AdminSeoController {
  constructor(private readonly seo: SeoManagementService) {}
  @Get('settings') @Permissions('seo.read') getSettings() { return this.seo.adminSettings(); }
  @Patch('settings') @Permissions('seo.manage') updateSettings(@CurrentUser() actor: User, @Body() dto: SeoSettingsDto) { return this.seo.updateSettings(actor, dto); }
  @Get('pages') @Permissions('seo.read') listPages(@Query() query: SeoPageListQueryDto) { return this.seo.listPages(query); }
  @Get('pages/:id') @Permissions('seo.read') @ApiParam({ name: 'id', required: true, type: String, description: 'SEO page ID.' }) getPage(@Param('id') id: string) { return this.seo.getPage(id); }
  @Post('pages') @Permissions('seo.manage') upsertPage(@CurrentUser() actor: User, @Body() dto: UpsertSeoPageDto) { return this.seo.upsertPage(actor, dto); }
  @Delete('pages/:id') @Permissions('seo.manage') @ApiParam({ name: 'id', required: true, type: String, description: 'SEO page ID.' }) deletePage(@CurrentUser() actor: User, @Param('id') id: string) { return this.seo.deletePage(actor, id); }
  @Get('redirects') @Permissions('seo.read') listRedirects() { return this.seo.listRedirects(); }
  @Post('redirects') @Permissions('seo.manage') upsertRedirect(@CurrentUser() actor: User, @Body() dto: SeoRedirectDto) { return this.seo.upsertRedirect(actor, dto); }
  @Delete('redirects/:id') @Permissions('seo.manage') @ApiParam({ name: 'id', required: true, type: String, description: 'SEO redirect ID.' }) deleteRedirect(@CurrentUser() actor: User, @Param('id') id: string) { return this.seo.deleteRedirect(actor, id); }
  @Get('sitemap-entries') @Permissions('seo.read') listSitemapEntries() { return this.seo.listSitemapEntries(); }
  @Post('sitemap-entries') @Permissions('seo.manage') upsertSitemapEntry(@CurrentUser() actor: User, @Body() dto: SeoSitemapEntryDto) { return this.seo.upsertSitemapEntry(actor, dto); }
  @Delete('sitemap-entries/:id') @Permissions('seo.manage') @ApiParam({ name: 'id', required: true, type: String, description: 'SEO sitemap entry ID.' }) deleteSitemapEntry(@CurrentUser() actor: User, @Param('id') id: string) { return this.seo.deleteSitemapEntry(actor, id); }
}
