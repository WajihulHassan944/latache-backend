import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBooleanString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { User } from '../../generated/prisma/client';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminAlertsService } from './admin-alerts.service';

class AlertsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsBooleanString() unread?: string;
  @IsOptional() @IsString() @MaxLength(40) type?: string;
  @IsOptional() @IsIn(['info', 'warning', 'critical']) severity?: string;
}

@ApiTags('66 Admin alerts')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/alerts')
export class AdminAlertsController {
  constructor(private readonly alerts: AdminAlertsService) {}

  @Get()
  @Permissions('alerts.read')
  @ApiOperation({ summary: 'Alerts for the admin bell and the alerts center (with per-admin read state)' })
  list(@CurrentUser() admin: User, @Query() query: AlertsQueryDto) {
    return this.alerts.list(admin.id, { ...query, unread: query.unread === 'true' });
  }

  @Get('unread-count')
  @Permissions('alerts.read')
  async unread(@CurrentUser() admin: User) {
    return { unread: await this.alerts.unreadCount(admin.id) };
  }

  @Post('read-all')
  @Permissions('alerts.read')
  readAll(@CurrentUser() admin: User) {
    return this.alerts.markAllRead(admin.id);
  }

  @Post(':id/read')
  @Permissions('alerts.read')
  @ApiParam({ name: 'id', type: String })
  read(@CurrentUser() admin: User, @Param('id') id: string) {
    return this.alerts.markRead(admin.id, id);
  }
}
