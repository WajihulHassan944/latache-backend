import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { User } from '../../generated/prisma/client';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminConversationsService } from './admin-conversations.service';
import { AdminListConversationsQueryDto, ConversationIdParamDto, ListMessagesQueryDto } from './conversations.dto';

@ApiTags('59 Admin - Conversations')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'A valid administrator session is required.' })
@ApiForbiddenResponse({ description: 'Requires conversations.read (Super Admin always allowed).' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('conversations.read')
@Controller('admin/conversations')
export class AdminConversationsController {
  constructor(private readonly conversations: AdminConversationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List every customer-tasker conversation (read-only)',
    description:
      'Filter by customerId, taskerId, bookingId, or search across names, emails, IDs and message text. Most recent activity first.',
  })
  list(@Query() query: AdminListConversationsQueryDto) {
    return this.conversations.list(query);
  }

  @Get(':conversationId')
  @ApiParam({ name: 'conversationId', type: String })
  @ApiOperation({ summary: 'Conversation summary with both parties, every booking and any disputes on them' })
  detail(@Param() params: ConversationIdParamDto) {
    return this.conversations.detail(params.conversationId);
  }

  @Get(':conversationId/messages')
  @ApiParam({ name: 'conversationId', type: String })
  @ApiOperation({
    summary: 'Read the full message history of a conversation',
    description:
      'Same pagination as the participant endpoint (page/limit or cursor). Never marks anything as read for the participants. Opening the first page is recorded in the admin audit log as conversation_viewed.',
  })
  messages(
    @CurrentUser() actor: User,
    @Param() params: ConversationIdParamDto,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.conversations.messages(actor, params.conversationId, query);
  }
}
