import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
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
import {
  AdminDateRangeQueryDto,
  AdminUserModerationDto,
  ListAdminTaskersDto,
  TaskerVerificationActionDto,
} from '../dto';
import { AdminAnalyticsService } from '../services/admin-analytics.service';
import { AdminTaskersService } from '../services/admin-taskers.service';
import { PermanentDeleteDto } from '../../account-deletion/dto/permanent-delete.dto';

@ApiTags('22 Admin Dashboard - Taskers')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'A valid active administrator session is required.' })
@ApiForbiddenResponse({ description: 'The administrator lacks the required permission.' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/taskers')
export class AdminTaskersController {
  constructor(
    private readonly taskers: AdminTaskersService,
    private readonly analytics: AdminAnalyticsService,
  ) {}

  @Get()
  @Permissions('taskers.read')
  @ApiOperation({ summary: 'List Taskers for Tasker Management' })
  list(@Query() query: ListAdminTaskersDto) {
    return this.taskers.list(query);
  }

  @Get('pending-verification')
  @Permissions('taskers.read')
  @ApiOperation({
    summary: 'List Taskers awaiting approval',
    description:
      'The queue is based on real pending-approval/onboarding state. Background-check and insurance provider results are not invented and remain null until such providers are integrated.',
  })
  pending(@Query() query: ListAdminTaskersDto) {
    return this.taskers.pendingVerification(query);
  }

  @Get('performance')
  @Permissions('analytics.read')
  @ApiOperation({ summary: 'Tasker performance monitoring' })
  performance(@Query() query: AdminDateRangeQueryDto) {
    return this.analytics.performance(query);
  }

  @Get('earnings')
  @Permissions('taskers.read', 'finance.read')
  @ApiOperation({
    summary: 'Tasker earnings monitoring',
    description:
      'Uses settled Tasker wallet ledger entries and paid withdrawals. Platform revenue uses actual paid-booking platform fees.',
  })
  earnings(@Query() query: AdminDateRangeQueryDto) {
    return this.analytics.taskerEarnings(query);
  }

  @Get(':id')
  @Permissions('taskers.read')
  @ApiParam({ name: 'id', type: Number, example: 58 })
  @ApiOperation({ summary: 'Get private Tasker verification/profile details' })
  @ApiNotFoundResponse({ description: 'Tasker not found.' })
  details(@Param('id', ParseIntPipe) id: number) {
    return this.taskers.details(id);
  }

  @Delete(':id')
  @Permissions('taskers.delete')
  @ApiOperation({
    summary: 'Permanently delete an eligible Tasker and managed assets',
    description:
      'Irreversible hard deletion. Requires the exact confirmation phrase. Protected bookings, earnings, wallet/platform ledgers, cash receivables, withdrawals, disputes, reviews, or other immutable history block deletion. Cloudinary deletion is durable and retryable.',
  })
  @ApiOkResponse({ description: 'Tasker and eligible dependent records permanently deleted.' })
  @ApiConflictResponse({
    description: 'ACCOUNT_PURGE_BLOCKED with the exact protected-resource counts.',
  })
  permanentlyDelete(
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PermanentDeleteDto,
  ) {
    return this.taskers.permanentlyDelete(actor, id, dto.reason);
  }

  @Post(':id/verification')
  @Permissions('taskers.manage')
  @ApiOperation({
    summary: 'Approve or reject a Tasker application',
    description:
      'Approval is blocked unless email, identity document, services, availability and service-area checks backed by Latache data pass. Rejection requires a reason and revokes active sessions.',
  })
  @ApiConflictResponse({ description: 'Required verification data is incomplete.' })
  verify(
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TaskerVerificationActionDto,
  ) {
    return this.taskers.verify(actor, id, dto);
  }

  @Patch(':id/status')
  @Permissions('taskers.manage')
  @ApiOperation({
    summary: 'Suspend, reactivate or ban/deactivate a Tasker',
    description:
      'Suspension and ban revoke sessions and are audit logged. Reactivation requires an already-approved Tasker. Reactivating a banned/deactivated Tasker is super-admin-only.',
  })
  @ApiOkResponse({ description: 'Tasker state updated.' })
  moderate(
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminUserModerationDto,
  ) {
    return this.taskers.moderate(actor, id, dto);
  }
}
