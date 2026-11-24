import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { User } from '../../generated/prisma/client';
import { PerformanceJobsService } from '../../infrastructure/jobs/performance-jobs.service';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { UserRole } from '../../common/enums/user-role.enum';
import { AdminSearchService } from './admin-search.service';
import { SystemAdminService } from './system-admin.service';

class FailedQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

class CleanFailedDto {
  @IsInt() @Type(() => Number) @Min(0) @Max(365) olderThanDays!: number;
}

class SearchQueryDto {
  @IsString() @MaxLength(80) q!: string;
}

class AuditQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(80) action?: string;
  @IsOptional() @IsString() @MaxLength(64) entityType?: string;
  @IsOptional() @IsString() @MaxLength(64) entityId?: string;
  @IsOptional() @Type(() => Number) @IsInt() actorId?: number;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

@ApiTags('69 System (admin)')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/system')
export class SystemAdminController {
  constructor(
    private readonly jobs: PerformanceJobsService,
    private readonly audit: AdminAuditService,
    private readonly system: SystemAdminService,
    private readonly search: AdminSearchService,
  ) {}

  @Get('search')
  @ApiOperation({ summary: 'Global admin search (Ctrl+K): only returns record types the admin may read' })
  globalSearch(@Query() query: SearchQueryDto, @Req() request: AuthenticatedRequest) {
    const isSuper = request.auth.role === UserRole.SuperAdmin;
    const available = new Set(request.user.permissions);
    return this.search.search(query.q, { can: (permission) => isSuper || available.has(permission) });
  }

  @Get('health')
  @Permissions('system.read')
  @ApiOperation({ summary: 'API, database, Redis and queue status in one call (powers the System health page)' })
  health() {
    return this.system.health();
  }

  @Get('jobs')
  @Permissions('system.read')
  @ApiOperation({ summary: 'Queue counts and the scheduled recurring jobs' })
  overview() {
    return this.jobs.adminOverview();
  }

  @Get('jobs/failed')
  @Permissions('system.read')
  @ApiOperation({ summary: 'Newest failed jobs and a grouped summary of why they failed' })
  failed(@Query() query: FailedQueryDto) {
    return this.jobs.adminFailed(query.limit ?? 25, query.offset ?? 0);
  }

  @Post('jobs/failed/clean')
  @Permissions('system.manage')
  @ApiOperation({ summary: 'Remove failed jobs older than N days (audited)' })
  async clean(@CurrentUser() admin: User, @Body() dto: CleanFailedDto) {
    const removed = await this.jobs.adminCleanFailed(dto.olderThanDays * 86_400_000);
    await this.audit.record({ actorId: admin.id, action: 'system_failed_jobs_cleaned', entityType: 'queue', entityId: 'maintenance', metadata: { olderThanDays: dto.olderThanDays, removed } });
    return { removed };
  }

  @Post('jobs/failed/:id/retry')
  @Permissions('system.manage')
  @ApiParam({ name: 'id', type: String })
  async retry(@CurrentUser() admin: User, @Param('id') id: string) {
    const ok = await this.jobs.adminRetryFailed(id);
    if (!ok) throw new NotFoundException('That job no longer exists');
    await this.audit.record({ actorId: admin.id, action: 'system_failed_job_retried', entityType: 'queue', entityId: id });
    return { retried: true };
  }

  @Get('audit-logs')
  @Permissions('audit.read')
  @ApiOperation({ summary: 'Admin action history with filters (who did what, when, to which record)' })
  auditLogs(@Query() query: AuditQueryDto) {
    return this.system.auditLogs(query);
  }
}
