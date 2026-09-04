import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import type { User } from '../../../generated/prisma/client';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import { AdminBookingActionDto, AdminBookingsQueryDto } from '../dto';
import { AdminBookingsService } from '../services/admin-bookings.service';

@ApiTags('56 Admin - Booking Management')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'A valid active administrator session is required.' })
@ApiForbiddenResponse({ description: 'The administrator lacks the required permission.' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly bookings: AdminBookingsService) {}

  @Get()
  @Permissions('bookings.read')
  @ApiOperation({
    summary: 'Booking Management list, tabs, summary metrics, and CSV export',
    description:
      'One endpoint powers All, Pending, Accepted, In Progress, Completed, Cancelled, and Disputed tabs. In Progress includes awaiting_customer_approval and exposes its approval deadline. Accepted maps to the canonical confirmed status; Disputed is derived from unresolved complaint records. format=csv returns the same filtered dataset as CSV.',
  })
  @ApiProduces('application/json', 'text/csv')
  async list(
    @CurrentUser() actor: User,
    @Query() query: AdminBookingsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (query.format === 'csv') {
      const exported = await this.bookings.csv(actor, query);
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="latache-bookings-${query.view ?? 'all'}.csv"`,
      );
      response.setHeader('X-Export-Truncated', String(exported.truncated));
      return exported.body;
    }
    return this.bookings.list(query);
  }

  @Get(':id')
  @Permissions('bookings.read')
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Booking ID.', example: 8291 })
  @ApiOperation({
    summary: 'Get complete admin booking context',
    description:
      'Returns participants, service, completion submission/approval timestamps, payment transactions, active/historical disputes, work session, location, and audit history without duplicating payment or dispute mutation APIs.',
  })
  details(@Param('id', ParseIntPipe) id: number) {
    return this.bookings.details(id);
  }

  @Post(':id/actions')
  @Permissions('bookings.manage')
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Booking ID.', example: 8291 })
  @ApiOperation({
    summary: 'Perform a safe administrative booking lifecycle action',
    description:
      'Currently supports only exceptional cancellation of a non-paid booking with no active dispute. Paid/disputed bookings must use Dispute Management so refund/payment invariants cannot be bypassed.',
  })
  @ApiBody({
    type: AdminBookingActionDto,
    examples: {
      cancel: {
        summary: 'Exceptional administrative cancellation',
        value: {
          action: 'cancel',
          reason: 'Customer and Tasker both confirmed that the booking should be cancelled.',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Administrative booking action applied and audit logged.' })
  action(
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminBookingActionDto,
  ) {
    return this.bookings.action(actor, id, dto);
  }
}
