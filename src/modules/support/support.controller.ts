import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums/user-role.enum';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateSupportTicketDto,
  ListSupportMessagesQueryDto,
  ListOwnSupportTicketsQueryDto,
  MarkSupportReadDto,
  SendSupportMessageDto,
  SupportFeedbackDto,
  SupportTicketParamDto,
  SupportTicketUserActionDto,
} from './dto/support.dto';
import { SupportService } from './support.service';

@ApiTags('15 Support')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Customer, UserRole.Tasker)
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('capabilities')
  @ApiOperation({
    summary: 'Get support chat limits and integration capabilities',
    description:
      'Returns live-chat availability, shared Cloudinary attachment limits, idempotency fields, and the canonical realtime connection contract.',
  })
  capabilities(): Promise<unknown> {
    return this.support.capabilities();
  }

  @Post()
  @ApiOperation({
    summary: 'Open a support ticket or live-chat case',
    description:
      'Customer and Tasker use the same support resource. channel=ticket creates an asynchronous case; channel=live_chat creates the same persisted case with chat semantics. Booking/payment/withdrawal references are ownership-validated. Supply clientRequestId for retry-safe creation.',
  })
  @ApiBody({
    type: CreateSupportTicketDto,
    examples: {
      customerBookingIssue: {
        value: {
          channel: 'ticket',
          subject: 'Unable to cancel booking',
          category: 'booking',
          priority: 'normal',
          description: 'The app would not let me cancel booking 1842.',
          bookingId: 1842,
        },
      },
      taskerPayoutChat: {
        value: {
          channel: 'live_chat',
          subject: 'Payout has not arrived',
          category: 'payment',
          priority: 'high',
          description: 'My approved payout has not arrived yet.',
          referenceType: 'tasker_withdrawal',
          referenceId: 'cm5withdrawal123',
        },
      },
    },
  })
  create(@CurrentUser() user: User, @Body() dto: CreateSupportTicketDto): Promise<unknown> {
    return this.support.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List support tickets owned by the authenticated customer or tasker' })
  list(@CurrentUser() user: User, @Query() query: ListOwnSupportTicketsQueryDto): Promise<unknown> {
    return this.support.listOwn(user, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get total unread public support messages for the current user' })
  unreadCount(@CurrentUser() user: User): Promise<{ unreadCount: number }> {
    return this.support.unreadCountOwn(user);
  }

  @Get(':id')
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Support ticket ID.' })
  @ApiOperation({ summary: 'Get one owned support ticket with linked booking/payment context' })
  detail(@CurrentUser() user: User, @Param() params: SupportTicketParamDto): Promise<unknown> {
    return this.support.detailForUser(user, params.id);
  }

  @Get(':id/messages')
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Support ticket ID.' })
  @ApiOperation({
    summary: 'Get public support conversation messages for one owned ticket',
    description:
      'Supports cursor or page pagination and returns messages chronologically within the window. Reading history has no write side effect; use the read endpoint after rendering. Internal notes are never returned.',
  })
  messages(
    @CurrentUser() user: User,
    @Param() params: SupportTicketParamDto,
    @Query() query: ListSupportMessagesQueryDto,
  ): Promise<unknown> {
    return this.support.messagesOwn(user, params.id, query);
  }

  @Post(':id/messages')
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Support ticket ID.' })
  @ApiOperation({
    summary: 'Reply to support',
    description:
      'Attachments must first be uploaded through the existing Cloudinary upload API using folder=support-attachments. Text is optional when an attachment is present. Supply clientMessageId for retry-safe delivery.',
  })
  send(
    @CurrentUser() user: User,
    @Param() params: SupportTicketParamDto,
    @Body() dto: SendSupportMessageDto,
  ): Promise<unknown> {
    return this.support.sendOwn(user, params.id, dto);
  }

  @Post(':id/read')
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Support ticket ID.' })
  @ApiOperation({ summary: 'Mark public agent replies as read through an optional message' })
  markRead(
    @CurrentUser() user: User,
    @Param() params: SupportTicketParamDto,
    @Body() dto: MarkSupportReadDto,
  ): Promise<unknown> {
    return this.support.markReadOwn(user, params.id, dto);
  }

  @Post(':id/actions')
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Support ticket ID.' })
  @ApiOperation({ summary: 'Close or reopen an owned support case' })
  action(
    @CurrentUser() user: User,
    @Param() params: SupportTicketParamDto,
    @Body() dto: SupportTicketUserActionDto,
  ): Promise<unknown> {
    return this.support.userAction(user, params.id, dto);
  }

  @Post(':id/feedback')
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Support ticket ID.' })
  @ApiOperation({
    summary: 'Submit a real post-resolution satisfaction score',
    description:
      'One 1–5 rating is accepted after resolution/closure and powers Support Center CSAT reports. No satisfaction percentage is fabricated when no feedback exists.',
  })
  feedback(
    @CurrentUser() user: User,
    @Param() params: SupportTicketParamDto,
    @Body() dto: SupportFeedbackDto,
  ): Promise<unknown> {
    return this.support.feedback(user, params.id, dto);
  }
}
