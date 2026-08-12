import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums/user-role.enum';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateSupportTicketDto,
  ListOwnSupportTicketsQueryDto,
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

  @Post()
  @ApiOperation({
    summary: 'Open a support ticket or live-chat case',
    description:
      'Customer and Tasker use the same support resource. channel=ticket creates an asynchronous case; channel=live_chat creates the same persisted case with chat semantics. Booking/payment/withdrawal references are ownership-validated.',
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

  @Get(':id')
  @ApiOperation({ summary: 'Get one owned support ticket with linked booking/payment context' })
  detail(@CurrentUser() user: User, @Param() params: SupportTicketParamDto): Promise<unknown> {
    return this.support.detailForUser(user.id, params.id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get public support conversation messages for one owned ticket' })
  messages(@CurrentUser() user: User, @Param() params: SupportTicketParamDto): Promise<unknown> {
    return this.support.messagesOwn(user, params.id);
  }

  @Post(':id/messages')
  @ApiOperation({
    summary: 'Reply to support',
    description:
      'Attachments must first be uploaded through the existing Cloudinary upload API using folder=support-attachments.',
  })
  send(
    @CurrentUser() user: User,
    @Param() params: SupportTicketParamDto,
    @Body() dto: SendSupportMessageDto,
  ): Promise<unknown> {
    return this.support.sendOwn(user, params.id, dto);
  }

  @Post(':id/actions')
  @ApiOperation({ summary: 'Close or reopen an owned support case' })
  action(
    @CurrentUser() user: User,
    @Param() params: SupportTicketParamDto,
    @Body() dto: SupportTicketUserActionDto,
  ): Promise<unknown> {
    return this.support.userAction(user, params.id, dto);
  }

  @Post(':id/feedback')
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
