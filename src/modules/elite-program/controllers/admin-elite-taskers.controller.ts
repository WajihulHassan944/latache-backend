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
  CreateEliteBadgeDto,
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

@ApiTags('23 Admin - Elite Tasker Program')
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
      'A single settings payload powers tier/benefit/badge management screens. Benefits are configuration only until a consuming module explicitly implements the effect; no discounts or bonuses are fabricated.',
  })
  program(): Promise<Record<string, unknown>> {
    return this.elite.program();
  }

  @Patch('program/tiers/:tierCode')
  @Permissions('elite.manage')
  @ApiParam({ name: 'tierCode', enum: ['gold', 'platinum', 'diamond'] })
  @ApiOperation({
    summary: 'Update one Elite tier policy and eligibility requirements',
    description:
      'Stores real, administrator-configured thresholds for rating, completed tasks, completion rate, open complaints, and settled earnings. The application score is derived from these rules; no default threshold or fake score is invented.',
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
  @ApiParam({ name: 'tierCode', enum: ['gold', 'platinum', 'diamond'] })
  @ApiOperation({
    summary: 'Replace all configured benefits for one Elite tier',
    description:
      'Bulk replacement keeps the UI simple and prevents a separate CRUD call for every benefit row. The persisted benefit codes can later be integrated by payments, booking priority, support, or marketing modules.',
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

  @Post('requests/:requestId/decision')
  @Permissions('elite.manage')
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
  @ApiParam({ name: 'taskerId', type: Number })
  @ApiOperation({ summary: 'Get one Tasker Elite program detail view' })
  @ApiNotFoundResponse({ description: 'Tasker not found.' })
  details(@Param('taskerId', ParseIntPipe) taskerId: number): Promise<Record<string, unknown>> {
    return this.elite.details(taskerId);
  }
}
