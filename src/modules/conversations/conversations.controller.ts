import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  BookingConversationParamDto,
  ConversationCallParamDto,
  ListConversationCallsQueryDto,
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  SendMessageDto,
} from './conversations.dto';
import { ConversationsService } from './conversations.service';
import type {
  ConversationCallListView,
  ConversationCallView,
  ConversationCapabilitiesView,
  ConversationListView,
  ConversationMessageView,
  ConversationView,
  MessageListView,
} from './conversations.types';

@ApiTags('07 Conversations')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
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
    summary: 'List booking conversations for the authenticated customer or tasker',
    description:
      'The same endpoint is used by both roles. Only bookings involving the authenticated identity are visible.',
  })
  list(
    @CurrentUser() user: User,
    @Query() query: ListConversationsQueryDto,
  ): Promise<ConversationListView> {
    return this.conversations.list(user.id, query);
  }

  @Get(':bookingId/messages')
  @ApiOperation({ summary: 'List messages for one owned booking conversation' })
  messages(
    @CurrentUser() user: User,
    @Param() params: BookingConversationParamDto,
    @Query() query: ListMessagesQueryDto,
  ): Promise<MessageListView> {
    return this.conversations.messages(user.id, params.bookingId, query);
  }

  @Post(':bookingId/messages')
  @ApiOperation({
    summary: 'Send text and/or verified Cloudinary attachments',
    description:
      'Supports one or multiple image/document attachments. Upload them first through the shared Uploads API using folder=conversation-attachments. The server revalidates ownership, Cloudinary existence, MIME type, per-file size, total message size, and duplicate references before persisting the message.',
  })
  send(
    @CurrentUser() user: User,
    @Param() params: BookingConversationParamDto,
    @Body() dto: SendMessageDto,
  ): Promise<ConversationMessageView> {
    return this.conversations.send(user, params.bookingId, dto);
  }

  @Post(':bookingId/read')
  @ApiOperation({ summary: 'Mark messages from the other booking participant as read' })
  markRead(
    @CurrentUser() user: User,
    @Param() params: BookingConversationParamDto,
  ): Promise<{ updated: number }> {
    return this.conversations.markRead(user.id, params.bookingId);
  }

  @Get(':bookingId/calls')
  @ApiOperation({
    summary: 'List persisted voice/video call history for a booking conversation',
    description:
      'Call lifecycle mutations and WebRTC signaling use the authenticated /realtime Socket.IO namespace. This REST endpoint is the reconnect/history source of truth.',
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
    return this.conversations.listCalls(user.id, params.bookingId, query);
  }

  @Get(':bookingId/calls/:callId')
  @ApiOperation({ summary: 'Get one persisted voice/video call record' })
  call(
    @CurrentUser() user: User,
    @Param() params: ConversationCallParamDto,
  ): Promise<ConversationCallView> {
    return this.conversations.getCall(user.id, params.bookingId, params.callId);
  }

  @Get(':bookingId')
  @ApiOperation({ summary: 'Get one booking conversation summary' })
  summary(
    @CurrentUser() user: User,
    @Param() params: BookingConversationParamDto,
  ): Promise<ConversationView> {
    return this.conversations.summary(user.id, params.bookingId);
  }
}
