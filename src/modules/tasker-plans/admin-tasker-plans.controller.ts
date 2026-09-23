import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { User } from '../../generated/prisma/client';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import {
  ListTaskerSubscriptionsDto,
  ReviewTaskerSubscriptionDto,
  TaskerSubscriptionParamDto,
  UpdateTaskerPlanCatalogDto,
} from './tasker-plans.dto';
import { TaskerPlansService } from './tasker-plans.service';

@ApiTags('55 Admin - Elite Tasker Program')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('elite.read')
@Controller('admin/tasker-plans')
export class AdminTaskerPlansController {
  constructor(private readonly plans: TaskerPlansService) {}

  @Get()
  @ApiOperation({ summary: 'List paid Tasker plan subscriptions (use status=pending for the review queue)' })
  list(@Query() query: ListTaskerSubscriptionsDto) {
    return this.plans.adminList(query);
  }

  @Get('catalog')
  @ApiOperation({ summary: 'Current paid-plan catalog (defaults merged with Super Admin overrides), including unavailable plans' })
  catalog() {
    return this.plans.adminCatalog();
  }

  @Put('catalog')
  @Permissions('elite.manage')
  @ApiOperation({
    summary: 'Super Admin: edit plan prices and perks',
    description:
      'Partial per-plan overrides (name, isAvailable, monthlyPrice, platformFeePercent, monthlyBonus, revenueSharePercent, supportTier, spotlightFrequency, perks). New purchases use new values immediately; existing subscribers pay the new price from their next renewal.',
  })
  updateCatalog(@CurrentUser() admin: User, @Body() dto: UpdateTaskerPlanCatalogDto) {
    return this.plans.updateCatalog(admin, dto);
  }

  @Post(':subscriptionId/terminate')
  @Permissions('elite.manage')
  @ApiOperation({ summary: 'End an active paid plan immediately (perks stop, no renewal, no automatic refund)' })
  terminate(
    @CurrentUser() admin: User,
    @Param() params: TaskerSubscriptionParamDto,
    @Body() dto: ReviewTaskerSubscriptionDto,
  ) {
    return this.plans.terminate(admin.id, params.subscriptionId, dto.note);
  }

  @Post(':subscriptionId/approve')
  @Permissions('elite.manage')
  @ApiOperation({ summary: 'Approve a pending paid plan: activates perks and pays the first monthly bonus' })
  approve(
    @CurrentUser() admin: User,
    @Param() params: TaskerSubscriptionParamDto,
    @Body() dto: ReviewTaskerSubscriptionDto,
  ) {
    return this.plans.approve(admin.id, params.subscriptionId, dto.note);
  }

  @Post(':subscriptionId/reject')
  @Permissions('elite.manage')
  @ApiOperation({ summary: 'Reject a pending paid plan and refund the payment to its original method' })
  reject(
    @CurrentUser() admin: User,
    @Param() params: TaskerSubscriptionParamDto,
    @Body() dto: ReviewTaskerSubscriptionDto,
  ) {
    return this.plans.reject(admin.id, params.subscriptionId, dto.note);
  }
}
