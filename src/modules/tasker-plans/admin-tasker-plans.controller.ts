import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
