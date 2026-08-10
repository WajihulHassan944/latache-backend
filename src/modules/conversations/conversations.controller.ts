import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  BookingConversationParamDto,
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  SendMessageDto,
} from './conversations.dto';
import { ConversationsService } from './conversations.service';
import type {
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

  @Get(':bookingId')
  @ApiOperation({ summary: 'Get one booking conversation summary' })
  summary(
    @CurrentUser() user: User,
    @Param() params: BookingConversationParamDto,
  ): Promise<ConversationView> {
    return this.conversations.summary(user.id, params.bookingId);
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
  @ApiOperation({ summary: 'Send a message or Cloudinary attachment to the other booking participant' })
  send(
    @CurrentUser() user: User,
    @Param() params: BookingConversationParamDto,
    @Body() dto: SendMessageDto,
  ): Promise<ConversationMessageView> {
    return this.conversations.send(user.id, params.bookingId, dto);
  }

  @Post(':bookingId/read')
  @ApiOperation({ summary: 'Mark messages from the other booking participant as read' })
  markRead(
    @CurrentUser() user: User,
    @Param() params: BookingConversationParamDto,
  ): Promise<{ updated: number }> {
    return this.conversations.markRead(user.id, params.bookingId);
  }
}
