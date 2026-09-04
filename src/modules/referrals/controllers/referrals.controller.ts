import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { RolesGuard } from '../../../common/guards/roles.guard';
import type { User } from '../../../generated/prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  ClaimReferralDto,
  ReferralHistoryQueryDto,
  ReferralLeaderboardQueryDto,
} from '../dto/referrals.dto';
import { ReferralsService } from '../services/referrals.service';

@ApiTags('21 Referrals')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'A valid active session is required.' })
@ApiForbiddenResponse({ description: 'Verified Customer or Tasker access is required.' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Customer, UserRole.Tasker)
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get my stable referral code, policy, attribution, and real reward summary',
    description:
      'Returns the program for the authenticated role. Programs are disabled by default; no reward appears unless a configured policy was snapshotted and a real online booking settled.',
  })
  @ApiOkResponse({ description: 'Role-specific referral state backed by PostgreSQL.' })
  me(@CurrentUser() user: User) {
    return this.referrals.me(user);
  }

  @Post('claim')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Claim a same-role referral code before the first settled booking',
    description:
      'Customer codes are customer-to-customer and Tasker codes are tasker-to-tasker. Self-referral, duplicate attribution, inactive referrers, cap exhaustion, and claims after any settled booking are rejected. Repeating the same successful claim is idempotent.',
  })
  @ApiOkResponse({
    description: 'Referral attribution created or the identical attribution returned.',
  })
  @ApiNotFoundResponse({ description: 'Referral code does not exist.' })
  @ApiConflictResponse({
    description: 'Program disabled, account already attributed/ineligible, or code cap reached.',
  })
  claim(@CurrentUser() user: User, @Body() dto: ClaimReferralDto) {
    return this.referrals.claim(user, dto.code);
  }

  @Get('history')
  @ApiOperation({
    summary: 'List my invited participants or immutable reward records',
    description:
      'Use view=invites for referrals made and view=rewards for pending, settled, reversed, or cancelled reward accounting.',
  })
  history(@CurrentUser() user: User, @Query() query: ReferralHistoryQueryDto) {
    return this.referrals.history(user, query);
  }

  @Get('leaderboard')
  @ApiOperation({
    summary: 'Get the privacy-limited referral leaderboard when Admin enabled it',
    description:
      'Ranks only qualified/rewarded referrals and exposes masked display names. A disabled leaderboard returns 404 rather than leaking dormant program data.',
  })
  @ApiNotFoundResponse({ description: 'Leaderboard or requested program is disabled.' })
  leaderboard(@CurrentUser() user: User, @Query() query: ReferralLeaderboardQueryDto) {
    return this.referrals.leaderboard(user, query);
  }
}
