import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ListNotificationsQueryDto, NotificationIdParamDto } from './notifications.dto';
import { NotificationsService } from './notifications.service';
import type { NotificationListView, NotificationView } from './notifications.types';
import { RequestLocale } from '../localization/request-locale.decorator';
import { FcmService } from '../fcm/fcm.service';
import { RegisterFcmTokenDto, RemoveFcmTokenDto } from '../fcm/fcm.dto';

@ApiTags('08 Notifications')
@ApiHeader({
  name: 'Accept-Language',
  required: false,
  example: 'ary-MA, ar;q=0.8, en;q=0.5',
  description:
    'Supports en, ar, and ary (Moroccan Darija). Saved preferredLanguage takes priority; English is the fallback.',
})
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly fcm: FcmService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List notifications for the authenticated identity',
    description:
      'One endpoint is shared by customers, taskers, and administrators. Stable template keys/parameters are persisted and title/body are rendered in English, Arabic, or Moroccan Darija using the saved preferred language (before Accept-Language), with English fallback. Existing page pagination remains supported; pass nextCursor as cursor for stable high-growth chronological pagination.',
  })
  list(
    @CurrentUser() user: User,
    @Query() query: ListNotificationsQueryDto,
    @RequestLocale() locale: string,
  ): Promise<NotificationListView> {
    return this.notifications.list(user.id, query, locale, user.role as UserRole);
  }

  @Post('push-tokens')
  @ApiOperation({ summary: 'Register or refresh an FCM push token for the authenticated user' })
  registerPushToken(
    @CurrentUser() user: User,
    @Body() dto: RegisterFcmTokenDto,
  ): Promise<{ registered: true }> {
    return this.fcm.registerToken(user.id, dto);
  }

  @Delete('push-tokens')
  @ApiOperation({ summary: 'Disable an FCM push token for the authenticated user' })
  removePushToken(
    @CurrentUser() user: User,
    @Body() dto: RemoveFcmTokenDto,
  ): Promise<{ removed: boolean }> {
    return this.fcm.removeToken(user.id, dto.token);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count for the authenticated user' })
  unreadCount(@CurrentUser() user: User): Promise<{ unreadCount: number }> {
    return this.notifications.unreadCount(user.id, user.role as UserRole);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one owned notification as read' })
  markRead(
    @CurrentUser() user: User,
    @Param() params: NotificationIdParamDto,
    @RequestLocale() locale: string,
  ): Promise<NotificationView> {
    return this.notifications.markRead(user.id, params.id, locale, user.role as UserRole);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all owned notifications as read' })
  markAllRead(@CurrentUser() user: User): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user.id, user.role as UserRole);
  }
}
