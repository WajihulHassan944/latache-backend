import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import type { User } from '../../../generated/prisma/client';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import { AdminDisputeActionDto, AdminDisputesQueryDto } from '../dto';
import { AdminDisputesService } from '../services/admin-disputes.service';

@ApiTags('57 Admin - Dispute Management')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'A valid active administrator session is required.' })
@ApiForbiddenResponse({ description: 'The administrator lacks the required permission.' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(private readonly disputes: AdminDisputesService) {}

  @Get()
  @Permissions('support.read')
  @ApiOperation({
    summary: 'Unified Dispute Management list for every dashboard tab',
    description:
      'Use view=open, under_investigation, escalated, resolved, evidence_review, resolution_actions, or all. The response includes real queue metrics and genuine post-dispute satisfaction aggregates from participant surveys.',
  })
  list(@Query() query: AdminDisputesQueryDto) {
    return this.disputes.list(query);
  }

  @Get(':id')
  @Permissions('support.read')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Dispute ID.', example: 'cm123abc456def' })
  @ApiOperation({
    summary: 'Get complete dispute case context',
    description:
      'Returns booking/payment data, verified evidence and evidence SLA state, participant comments/actions, settlement proposals, cash-refund confirmation state, disciplinary actions, satisfaction responses, delivery state, Stripe chargebacks, timeline, and remaining refundable amount.',
  })
  details(@Param('id') id: string) {
    return this.disputes.details(id);
  }

  @Post(':id/actions')
  @Permissions('support.manage')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Dispute ID.', example: 'cm123abc456def' })
  @ApiOperation({
    summary:
      'Single mutation endpoint for investigation, escalation, evidence, and resolution actions',
    description:
      'Supports start_investigation, assign, set_priority, escalate, request_evidence, add_evidence, review_evidence, save_resolution_draft, propose_resolution, resolve, confirm_cash_refund, and reopen. Refund actions additionally require finance.manage. Stripe refunds use real provider calls, wallet refunds use real ledger movements, and physical-cash refunds remain pending until an authorized Admin records an auditable manual-transfer confirmation.',
  })
  @ApiBody({
    type: AdminDisputeActionDto,
    examples: {
      investigate: {
        summary: 'Start investigation',
        value: { action: 'start_investigation' },
      },
      requestEvidence: {
        summary: 'Request evidence from both parties',
        value: {
          action: 'request_evidence',
          requestedFrom: 'both',
          message: 'Please provide photos, receipts, or messages relevant to the disputed work.',
          dueDate: '2026-08-15',
        },
      },
      partialRefund: {
        summary: 'Resolve with a real partial refund',
        value: {
          action: 'resolve',
          resolutionType: 'partial_refund',
          refundAmount: 60,
          notifyParties: true,
          resolutionSummary: 'Partial refund approved after reviewing the submitted evidence.',
        },
      },
      warning: {
        summary: 'Resolve with warning and no refund',
        value: {
          action: 'resolve',
          resolutionType: 'warning',
          warningTarget: 'tasker',
          notifyParties: true,
          resolutionSummary: 'Service was completed, but the Tasker receives a conduct warning.',
        },
      },
      draft: {
        summary: 'Save a resolution draft',
        value: {
          action: 'save_resolution_draft',
          resolutionType: 'full_refund',
          notifyParties: true,
          resolutionSummary: 'Proposed full refund pending final finance review.',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Case action applied or payment-provider refund orchestration started.',
  })
  action(@CurrentUser() actor: User, @Param('id') id: string, @Body() dto: AdminDisputeActionDto) {
    return this.disputes.action(actor, id, dto);
  }
}
