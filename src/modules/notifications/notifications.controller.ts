import { Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ListNotificationsQueryDto, NotificationIdParamDto } from './notifications.dto';
import { NotificationsService } from './notifications.service';
import type { NotificationListView, NotificationView } from './notifications.types';

@ApiTags('08 Notifications')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List notifications for the authenticated identity',
    description:
      'One endpoint is shared by customers, taskers, and administrators. Results are always scoped to the authenticated user.',
  })
  list(
    @CurrentUser() user: User,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationListView> {
    return this.notifications.list(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count for the authenticated user' })
  unreadCount(@CurrentUser() user: User): Promise<{ unreadCount: number }> {
    return this.notifications.unreadCount(user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one owned notification as read' })
  markRead(
    @CurrentUser() user: User,
    @Param() params: NotificationIdParamDto,
  ): Promise<NotificationView> {
    return this.notifications.markRead(user.id, params.id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all owned notifications as read' })
  markAllRead(@CurrentUser() user: User): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user.id);
  }
}
