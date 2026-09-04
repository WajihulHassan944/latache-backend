import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { UserRole } from '../../common/enums/user-role.enum';
import type { User } from '../../generated/prisma/client';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import {
  AdminSendSupportMessageDto,
  AdminSupportActionDto,
  AdminSupportQueryDto,
  ListSupportMessagesQueryDto,
  MarkSupportReadDto,
  SupportTicketParamDto,
} from './dto/support.dto';
import { SupportService } from './support.service';

@ApiTags('59 Admin - Support Center')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @Permissions('support.read')
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({
    summary: 'Unified Support Center queue and report API',
    description:
      'Use view=support_tickets|customer_issues|tasker_issues|escalated|live_chat|reports. Ticket and live-chat tabs are filtered views over the same persisted SupportTicket resource. format=csv is available only for reports and additionally requires reports.read.',
  })
  async read(
    @CurrentUser() actor: User,
    @Query() query: AdminSupportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    if (query.format === 'csv') {
      if (actor.role !== UserRole.SuperAdmin && !actor.permissions.includes('reports.read')) {
        throw new ForbiddenException('reports.read is required for Support Center CSV exports');
      }
      const result = await this.support.adminCsv(query);
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.body;
    }
    return this.support.adminRead(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Support ticket ID.' })
  @Permissions('support.read')
  @ApiOperation({
    summary: 'Get a complete support case',
    description:
      'Returns user, booking/reference context, assignment/escalation state, public conversation and internal support notes.',
  })
  detail(@Param() params: SupportTicketParamDto): Promise<unknown> {
    return this.support.adminDetail(params.id);
  }

  @Get(':id/messages')
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Support ticket ID.' })
  @Permissions('support.read')
  @ApiOperation({
    summary: 'Get live-chat/ticket message history including internal notes',
    description:
      'Supports cursor or page pagination. Reading history has no write side effect; use the read endpoint after rendering. Internal notes remain restricted to authorized support administrators.',
  })
  messages(
    @Param() params: SupportTicketParamDto,
    @Query() query: ListSupportMessagesQueryDto,
  ): Promise<unknown> {
    return this.support.adminMessages(params.id, query);
  }

  @Post(':id/messages')
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Support ticket ID.' })
  @Permissions('support.manage')
  @ApiOperation({
    summary: 'Reply to the user or add an internal support note',
    description:
      'A public first reply records firstResponseAt for real response-time reporting. Internal notes never notify the customer/tasker or enter the public room. Supply clientMessageId for retry-safe delivery.',
  })
  send(
    @CurrentUser() actor: User,
    @Param() params: SupportTicketParamDto,
    @Body() dto: AdminSendSupportMessageDto,
  ): Promise<unknown> {
    return this.support.adminSend(actor, params.id, dto);
  }

  @Post(':id/read')
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Support ticket ID.' })
  @Permissions('support.read')
  @ApiOperation({ summary: 'Mark participant replies as read through an optional message' })
  markRead(
    @CurrentUser() actor: User,
    @Param() params: SupportTicketParamDto,
    @Body() dto: MarkSupportReadDto,
  ): Promise<unknown> {
    return this.support.adminMarkRead(actor, params.id, dto);
  }

  @Post(':id/actions')
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Support ticket ID.' })
  @Permissions('support.manage')
  @ApiOperation({
    summary: 'Assign, prioritize, escalate, resolve, close, or reopen a support case',
    description:
      'Financial refunds/payout settlement are deliberately not executed here; those remain in Dispute/Finance modules. Support resolution records only the support outcome.',
  })
  @ApiBody({
    type: AdminSupportActionDto,
    examples: {
      assign: { value: { action: 'assign', assignedAdminId: 14 } },
      prioritize: { value: { action: 'set_priority', priority: 'urgent' } },
      escalate: {
        value: {
          action: 'escalate',
          reason: 'Payment provider investigation is required.',
        },
      },
      resolve: {
        value: {
          action: 'resolve',
          resolutionSummary:
            'The payout record was reconciled in Finance and the Tasker was informed.',
        },
      },
    },
  })
  action(
    @CurrentUser() actor: User,
    @Param() params: SupportTicketParamDto,
    @Body() dto: AdminSupportActionDto,
  ): Promise<unknown> {
    return this.support.adminAction(actor, params.id, dto);
  }
}
