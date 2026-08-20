import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import type { User } from '../../../generated/prisma/client';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import { AdminReferralQueryDto, ReferralParamDto, RevokeReferralDto } from '../dto/referrals.dto';
import { ReferralsService } from '../services/referrals.service';

@ApiTags('34 Admin - Referrals')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'A valid administrator session is required.' })
@ApiForbiddenResponse({ description: 'The administrator lacks the required finance permission.' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/referrals')
export class AdminReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  @Permissions('finance.read')
  @ApiOperation({
    summary: 'List real referral attributions and reward accounting',
    description:
      'Reads the same referral/reward records consumed by Customer, Tasker, settlement, refund, and worker flows. Supports program/status/user filters and pagination.',
  })
  list(@Query() query: AdminReferralQueryDto) {
    return this.referrals.adminList(query);
  }

  @Get(':id')
  @Permissions('finance.read')
  @ApiOperation({
    summary: 'Inspect one referral, qualification booking, rewards, and linked wallet entries',
  })
  @ApiNotFoundResponse({ description: 'Referral not found.' })
  detail(@Param() params: ReferralParamDto) {
    return this.referrals.adminDetail(params.id);
  }

  @Post(':id/revoke')
  @Permissions('finance.manage')
  @ApiOperation({
    summary: 'Revoke an ineligible referral and reverse only its settled wallet rewards',
    description:
      'Requires a durable reason and creates immutable reversal ledger entries. Pending rewards are cancelled, wallet balances may become negative to preserve a real clawback, and no provider payment/refund is fabricated. Repeating a completed revocation is idempotent.',
  })
  @ApiOkResponse({ description: 'Referral revoked and affected rewards adjusted atomically.' })
  @ApiNotFoundResponse({ description: 'Referral not found.' })
  revoke(
    @CurrentUser() actor: User,
    @Param() params: ReferralParamDto,
    @Body() dto: RevokeReferralDto,
  ) {
    return this.referrals.revoke(actor, params.id, dto.reason);
  }
}
