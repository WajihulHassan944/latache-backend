import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import type { User } from '../../../generated/prisma/client';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import { AdminDateRangeQueryDto } from '../../admin-dashboard/dto/admin-date-range-query.dto';
import {
  AdminEliteUpgradeRequestsQueryDto,
  CreateEliteBadgeDto,
  DecideEliteUpgradeRequestDto,
  EliteDecisionDto,
  EliteReportQueryDto,
  ListEliteAdminDto,
  ReplaceEliteBenefitsDto,
  RevokeEliteBadgeDto,
  SetEliteTierDto,
  UpdateEliteBadgeDto,
  UpdateEliteTierPolicyDto,
} from '../dto';
import { EliteProgramService } from '../services/elite-program.service';

@ApiTags('55 Admin - Elite Tasker Program')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'A valid active administrator session is required.' })
@ApiForbiddenResponse({
  description: 'The administrator lacks the required Elite Program permission.',
})
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('elite.read')
@Controller('admin/elite-taskers')
export class AdminEliteTaskersController {
  constructor(private readonly elite: EliteProgramService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Elite Program dashboard in one request',
    description:
      'Returns current tier totals, pending queues, tier history reconstructed from real transitions, recent program activity, and configuration counts. Pre-v3.8 elite users were safely mapped to Gold without fabricated historical transitions.',
  })
  overview(@Query() query: AdminDateRangeQueryDto): Promise<Record<string, unknown>> {
    return this.elite.overview(query);
  }

  @Get()
  @ApiOperation({
    summary: 'Unified Elite members and request queues',
    description:
      'Use view=members, applications, upgrade_requests, or downgrade_requests. Gold/Platinum/Diamond screens use the same endpoint with tier=gold|platinum|diamond, avoiding separate APIs for every tab.',
  })
  list(@Query() query: ListEliteAdminDto): Promise<Record<string, unknown>> {
    return this.elite.list(query);
  }

  @Get('program')
  @ApiOperation({
    summary: 'Get Elite tier, benefit, and badge configuration',
    description:
      'Returns tier policy, assigned backend-supported perks, badges, and the perk catalog. Tier/perk policy writes are Super-Admin-only; operational membership review remains permission-based.',
  })
  program(): Promise<Record<string, unknown>> {
    return this.elite.program();
  }

  @Get('program/perk-catalog')
  @ApiOperation({
    summary: 'Get backend-supported Elite perk catalog',
    description:
      'Returns the only perk codes that may be assigned to Gold/Platinum/Diamond. Perk effects are backend-enforced; policy writes are Super-Admin-only.',
  })
  perkCatalog(): Record<string, unknown> {
    return this.elite.perkCatalog();
  }

  @Patch('program/tiers/:tierCode')
  @Permissions('elite.manage')
  @ApiParam({
    name: 'tierCode',
    required: true,
    enum: ['gold', 'platinum', 'diamond'],
    description: 'Elite tier code.',
  })
  @ApiOperation({
    summary: 'Update one Elite tier policy and eligibility requirements',
    description:
      'Super-Admin policy endpoint. Stores real thresholds for rating, completed tasks, completion rate, open complaints, and settled earnings. Operational Admins may review memberships but cannot redefine tier eligibility.',
  })
  updateTierPolicy(
    @CurrentUser() actor: User,
    @Param('tierCode') tierCode: string,
    @Body() dto: UpdateEliteTierPolicyDto,
  ): Promise<Record<string, unknown>> {
    return this.elite.updateTierPolicy(actor, tierCode, dto);
  }

  @Put('program/tiers/:tierCode/benefits')
  @Permissions('elite.manage')
  @ApiParam({
    name: 'tierCode',
    required: true,
    enum: ['gold', 'platinum', 'diamond'],
    description: 'Elite tier code.',
  })
  @ApiOperation({
    summary: 'Replace all configured benefits for one Elite tier',
    description:
      'Super-Admin-only policy assignment. Accepts only backend-supported perk codes from /program/perk-catalog. Active assignments are consumed by profile/discovery and pricing flows; arbitrary declarative perk codes are rejected.',
  })
  benefits(
    @CurrentUser() actor: User,
    @Param('tierCode') tierCode: string,
    @Body() dto: ReplaceEliteBenefitsDto,
  ): Promise<Record<string, unknown>> {
    return this.elite.replaceBenefits(actor, tierCode, dto);
  }

  @Post('program/badges')
  @Permissions('elite.manage')
  @ApiOperation({ summary: 'Create an Elite badge definition' })
  createBadge(
    @CurrentUser() actor: User,
    @Body() dto: CreateEliteBadgeDto,
  ): Promise<Record<string, unknown>> {
    return this.elite.createBadge(actor, dto);
  }

  @Patch('program/badges/:badgeId')
  @Permissions('elite.manage')
  @ApiParam({ name: 'badgeId', required: true, type: String, description: 'Elite badge definition ID.' })
  @ApiOperation({ summary: 'Update or reactivate an Elite badge definition' })
  updateBadge(
    @CurrentUser() actor: User,
    @Param('badgeId') badgeId: string,
    @Body() dto: UpdateEliteBadgeDto,
  ): Promise<Record<string, unknown>> {
    return this.elite.updateBadge(actor, badgeId, dto);
  }

  @Delete('program/badges/:badgeId')
  @Permissions('elite.manage')
  @ApiParam({ name: 'badgeId', required: true, type: String, description: 'Elite badge definition ID.' })
  @ApiOperation({
    summary: 'Permanently delete an Elite badge definition',
    description:
      'Irreversibly deletes the badge, translations, current assignments and its managed Cloudinary asset. Requires elite.manage.',
  })
  deleteBadge(
    @CurrentUser() actor: User,
    @Param('badgeId') badgeId: string,
  ): Promise<Record<string, unknown>> {
    return this.elite.deleteBadge(actor, badgeId);
  }

  @Get('performance')
  @ApiOperation({
    summary: 'Elite performance analytics',
    description:
      'Uses current Elite members, actual bookings, complaints, settled tasker wallet earnings, and paid booking platform fees. Empty datasets return zero/empty collections.',
  })
  performance(@Query() query: AdminDateRangeQueryDto): Promise<Record<string, unknown>> {
    return this.elite.performance(query);
  }

  @Get('reports')
  @ApiOperation({
    summary: 'Elite reports as JSON or downloadable CSV',
    description:
      'Supports monthly_summary, tier_transitions, and benefit_utilization. Benefit utilization intentionally reports trackingAvailable=false until real usage events are integrated.',
  })
  async reports(
    @Query() query: EliteReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown> | string> {
    const type = query.type ?? 'monthly_summary';
    const data = await this.elite.reportData(query, type);
    if ((query.format ?? 'json') === 'csv') {
      response.type('text/csv');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="elite-${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      return this.elite.csvForReport(type, data);
    }
    return data;
  }

  @Get('upgrade-requests')
  @ApiOperation({
    summary: '[Compat] List Elite tier upgrade requests',
    description:
      'Thin alias for GET /admin/elite-taskers?view=upgrade_requests, kept for frontend code written against this specific URL shape. Same data, same elite.read permission, flat response fields (taskerId/taskerName/taskerEmail/currentTier/targetTier/rating/jobsCount/score/submittedAt/status).',
  })
  listUpgradeRequests(
    @Query() query: AdminEliteUpgradeRequestsQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.elite.listUpgradeRequestsCompat(query);
  }

  @Post('upgrade-requests/:id/decide')
  @Permissions('elite.manage')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Elite upgrade request ID.' })
  @ApiOperation({
    summary: '[Compat] Approve or reject an Elite tier upgrade request',
    description:
      'Thin alias for POST /admin/elite-taskers/requests/:id/decision, kept for frontend code written against this specific URL/field shape (decision/targetTier/reviewerNotes instead of action/reason). Runs the exact same decision logic: approve re-validates live eligibility and applies the tier transactionally; reject requires a reason and leaves the Tasker\'s tier unchanged. targetTier must match what the Tasker actually requested.',
  })
  @ApiConflictResponse({
    description:
      'Request is stale/no longer pending, ELITE_ELIGIBILITY_CHANGED, or ELITE_TARGET_TIER_MISMATCH.',
  })
  decideUpgradeRequest(
    @CurrentUser() actor: User,
    @Param('id') id: string,
    @Body() dto: DecideEliteUpgradeRequestDto,
  ): Promise<Record<string, unknown>> {
    return this.elite.decideUpgradeRequestCompat(actor, id, dto);
  }

  @Post('requests/:requestId/decision')
  @Permissions('elite.manage')
  @ApiParam({ name: 'requestId', required: true, type: String, description: 'Elite request ID.' })
  @ApiOperation({
    summary: 'Approve or reject any Elite application/upgrade/downgrade request',
    description:
      'One mutation handles all request types. Approval applies the requested tier transactionally and records a tier transition plus audit log. Rejection requires a reason.',
  })
  @ApiConflictResponse({ description: 'Request is stale or no longer pending.' })
  decide(
    @CurrentUser() actor: User,
    @Param('requestId') requestId: string,
    @Body() dto: EliteDecisionDto,
  ): Promise<Record<string, unknown>> {
    return this.elite.decide(actor, requestId, dto);
  }

  @Patch(':taskerId/tier')
  @Permissions('elite.manage')
  @ApiParam({ name: 'taskerId', required: true, type: Number, description: 'Tasker user ID.' })
  @ApiOperation({
    summary: 'Directly change a Tasker Elite tier',
    description:
      'Administrative exception path for corrections/manual review. Pending Elite requests are cancelled as superseded and the change is audit logged.',
  })
  setTier(
    @CurrentUser() actor: User,
    @Param('taskerId', ParseIntPipe) taskerId: number,
    @Body() dto: SetEliteTierDto,
  ): Promise<Record<string, unknown>> {
    return this.elite.setTier(actor, taskerId, dto);
  }

  @Post(':taskerId/badges/:badgeId')
  @Permissions('elite.manage')
  @ApiParam({ name: 'taskerId', required: true, type: Number, description: 'Tasker user ID.' })
  @ApiParam({ name: 'badgeId', required: true, type: String, description: 'Elite badge definition ID.' })
  @ApiOperation({ summary: 'Award or restore an Elite badge to a Tasker' })
  assignBadge(
    @CurrentUser() actor: User,
    @Param('taskerId', ParseIntPipe) taskerId: number,
    @Param('badgeId') badgeId: string,
  ): Promise<Record<string, unknown>> {
    return this.elite.assignBadge(actor, taskerId, badgeId);
  }

  @Delete(':taskerId/badges/:badgeId')
  @Permissions('elite.manage')
  @ApiParam({ name: 'taskerId', required: true, type: Number, description: 'Tasker user ID.' })
  @ApiParam({ name: 'badgeId', required: true, type: String, description: 'Elite badge definition ID.' })
  @ApiOperation({ summary: 'Revoke a Tasker Elite badge while retaining history' })
  revokeBadge(
    @CurrentUser() actor: User,
    @Param('taskerId', ParseIntPipe) taskerId: number,
    @Param('badgeId') badgeId: string,
    @Body() dto: RevokeEliteBadgeDto,
  ): Promise<Record<string, unknown>> {
    return this.elite.revokeBadge(actor, taskerId, badgeId, dto);
  }

  @Get(':taskerId')
  @ApiParam({ name: 'taskerId', required: true, type: Number, description: 'Tasker user ID.' })
  @ApiOperation({ summary: 'Get one Tasker Elite program detail view' })
  @ApiNotFoundResponse({ description: 'Tasker not found.' })
  details(@Param('taskerId', ParseIntPipe) taskerId: number): Promise<Record<string, unknown>> {
    return this.elite.details(taskerId);
  }
}
