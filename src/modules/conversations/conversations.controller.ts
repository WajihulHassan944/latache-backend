import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  BookingConversationParamDto,
  ConversationCallParamDto,
  ConversationIdParamDto,
  ConversationUserParamDto,
  ListConversationCallsQueryDto,
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  MarkConversationReadDto,
  SendMessageDto,
} from './conversations.dto';
import { ConversationsService } from './conversations.service';
import type {
  ConversationCallListView,
  ConversationCallView,
  ConversationCapabilitiesView,
  ConversationListView,
  ConversationMessageView,
  ConversationReadResultView,
  ConversationUnreadCountView,
  ConversationView,
  MessageListView,
} from './conversations.types';

@ApiTags('08 Conversations')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Customer, UserRole.Tasker)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get('capabilities')
  @ApiOperation({
    summary: 'Get chat attachment and voice/video-call capabilities',
    description:
      'Returns the canonical upload folder, MIME types, count/size limits, call eligibility rules, and Socket.IO/WebRTC integration endpoints. No duplicate chat upload API is introduced; clients reuse /api/uploads/single or /api/uploads/multiple.',
  })
  capabilities(): ConversationCapabilitiesView {
    return this.conversations.capabilities();
  }

  @Get()
  @ApiOperation({
    summary: 'List conversation relationships for the authenticated customer or tasker',
    description:
      'One row per customer-tasker relationship, not per booking. A relationship persists across every booking between the same pair and is never closed by a booking status - activeBooking/bookingHistory surface the relevant job context inline.',
  })
  list(
    @CurrentUser() user: User,
    @Query() query: ListConversationsQueryDto,
  ): Promise<ConversationListView> {
    return this.conversations.list(user, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get total unread chat messages for the current participant' })
  unreadCount(@CurrentUser() user: User): Promise<ConversationUnreadCountView> {
    return this.conversations.unreadCount(user);
  }

  @Get('with/:userId')
  @ApiParam({ name: 'userId', required: true, type: Number, description: "The other party's user ID." })
  @ApiOperation({
    summary: 'Get the conversation relationship with one other user',
    description:
      "Resolves by the counterparty's user ID rather than a conversation ID - no prior booking or prior contact required. Returns an empty relationship (id: null) if no message has ever been sent between this pair; the row is created lazily on first send, not on read.",
  })
  summaryWithUser(
    @CurrentUser() user: User,
    @Param() params: ConversationUserParamDto,
  ): Promise<ConversationView> {
    return this.conversations.summaryWithUser(user, params.userId);
  }

  @Get('with/:userId/messages')
  @ApiParam({ name: 'userId', required: true, type: Number, description: "The other party's user ID." })
  @ApiOperation({ summary: 'List messages with one other user, by their user ID' })
  messagesWithUser(
    @CurrentUser() user: User,
    @Param() params: ConversationUserParamDto,
    @Query() query: ListMessagesQueryDto,
  ): Promise<MessageListView> {
    return this.conversations.messagesWithUser(user, params.userId, query);
  }

  @Post('with/:userId/messages')
  @ApiParam({ name: 'userId', required: true, type: Number, description: "The other party's user ID." })
  @ApiOperation({
    summary: 'Send a message to one other user, auto-creating the relationship on first send',
    description:
      'Any customer may message any tasker (and vice versa) with no prior booking or contact required. Auto-creates the Conversation row for this pair on first send if none exists yet. Same body shape as sending into an existing conversation.',
  })
  sendToUser(
    @CurrentUser() user: User,
    @Param() params: ConversationUserParamDto,
    @Body() dto: SendMessageDto,
  ): Promise<ConversationMessageView> {
    return this.conversations.sendToUser(user, params.userId, dto);
  }

  @Get(':conversationId/messages')
  @ApiParam({ name: 'conversationId', required: true, type: String, description: 'Conversation ID.' })
  @ApiOperation({ summary: 'List messages for one owned conversation' })
  messages(
    @CurrentUser() user: User,
    @Param() params: ConversationIdParamDto,
    @Query() query: ListMessagesQueryDto,
  ): Promise<MessageListView> {
    return this.conversations.messagesByConversationId(user, params.conversationId, query);
  }

  @Post(':conversationId/messages')
  @ApiParam({ name: 'conversationId', required: true, type: String, description: 'Conversation ID.' })
  @ApiOperation({
    summary: 'Send text and/or verified Cloudinary attachments into an existing conversation',
    description:
      'Supports one or multiple image/document attachments. Upload them first through the shared Uploads API using folder=conversation-attachments. The server revalidates ownership, Cloudinary existence, MIME type, per-file size, total message size, and duplicate references before persisting the message. Supply a stable clientMessageId for retry-safe mobile/offline delivery.',
  })
  send(
    @CurrentUser() user: User,
    @Param() params: ConversationIdParamDto,
    @Body() dto: SendMessageDto,
  ): Promise<ConversationMessageView> {
    return this.conversations.sendMessage(user, params.conversationId, dto);
  }

  @Post(':conversationId/read')
  @ApiParam({ name: 'conversationId', required: true, type: String, description: 'Conversation ID.' })
  @ApiOperation({ summary: 'Mark messages from the other participant as read' })
  markRead(
    @CurrentUser() user: User,
    @Param() params: ConversationIdParamDto,
    @Body() dto: MarkConversationReadDto,
  ): Promise<ConversationReadResultView> {
    return this.conversations.markRead(user, params.conversationId, dto);
  }

  @Get(':bookingId/calls')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @ApiOperation({
    summary: 'List persisted voice/video call history for a booking',
    description:
      'Calls remain booking-scoped - unaffected by the relationship-scoped chat change. Call lifecycle mutations and WebRTC signaling use the authenticated /realtime Socket.IO namespace. This REST endpoint is the reconnect/history source of truth.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        bookingId: '125',
        page: 1,
        limit: 30,
        totalItems: 1,
        totalPages: 1,
        items: [
          {
            id: 'cm-call-id',
            bookingId: '125',
            type: 'video',
            status: 'ended',
            isInitiator: true,
            durationSeconds: 486,
            createdAt: '2026-08-12T10:00:00.000Z',
          },
        ],
      },
    },
  })
  calls(
    @CurrentUser() user: User,
    @Param() params: BookingConversationParamDto,
    @Query() query: ListConversationCallsQueryDto,
  ): Promise<ConversationCallListView> {
    return this.conversations.listCalls(user, params.bookingId, query);
  }

  @Get(':bookingId/calls/:callId')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @ApiParam({ name: 'callId', required: true, type: String, description: 'Conversation call ID.' })
  @ApiOperation({ summary: 'Get one persisted voice/video call record' })
  call(
    @CurrentUser() user: User,
    @Param() params: ConversationCallParamDto,
  ): Promise<ConversationCallView> {
    return this.conversations.getCall(user, params.bookingId, params.callId);
  }

  @Get(':conversationId')
  @ApiParam({ name: 'conversationId', required: true, type: String, description: 'Conversation ID.' })
  @ApiOperation({ summary: 'Get one conversation relationship summary' })
  summary(
    @CurrentUser() user: User,
    @Param() params: ConversationIdParamDto,
  ): Promise<ConversationView> {
    return this.conversations.summaryByConversationId(user, params.conversationId);
  }
}
