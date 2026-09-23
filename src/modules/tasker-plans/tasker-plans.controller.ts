import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PurchaseTaskerPlanDto, TaskerPlanParamDto } from './tasker-plans.dto';
import { TaskerPlansService } from './tasker-plans.service';

@ApiTags('14 Tasker - Paid Plans')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Tasker)
@Controller('tasker/plans')
export class TaskerPlansController {
  constructor(private readonly plans: TaskerPlansService) {}

  @Get()
  @ApiOperation({ summary: 'List purchasable Gold/Platinum/Diamond plans with prices and perks' })
  catalog() {
    return this.plans.catalog();
  }

  @Get('active')
  @ApiOperation({
    summary: "Get the Tasker's current paid plan",
    description:
      'planId/status are null when the Tasker has no pending or active plan. Separate from the earned Elite tier (GET /tasker-dashboard/elite).',
  })
  active(@CurrentUser() user: User) {
    return this.plans.active(user.id);
  }

  @Post('cancel')
  @ApiOperation({
    summary: 'Cancel the current plan',
    description:
      'A pending (not yet reviewed) purchase is cancelled and refunded to its original method. An active plan keeps its perks until nextBillingAt and then ends without another charge (autoRenew becomes false).',
  })
  cancel(@CurrentUser() user: User) {
    return this.plans.cancel(user.id);
  }

  @Post('resume')
  @ApiOperation({ summary: 'Turn auto-renewal back on for an active plan before its period ends' })
  resume(@CurrentUser() user: User) {
    return this.plans.resume(user.id);
  }

  @Post(':planId/purchase')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiParam({ name: 'planId', enum: ['gold', 'platinum', 'diamond'] })
  @ApiOperation({
    summary: 'Buy a paid plan (lands in pending for admin review)',
    description:
      "paymentMethod: 'wallet' | 'stripe' (default saved card) | a saved Stripe PaymentMethod id. No fallback between methods. The plan renews every 30 days on the same method.",
  })
  @ApiNotFoundResponse({ description: 'Unknown planId.' })
  @ApiConflictResponse({ description: 'An active or pending plan already exists, or no saved card.' })
  @ApiResponse({ status: 402, description: 'Insufficient wallet balance or card declined.' })
  purchase(
    @CurrentUser() user: User,
    @Param() params: TaskerPlanParamDto,
    @Body() dto: PurchaseTaskerPlanDto,
  ) {
    return this.plans.purchase(user.id, params.planId, dto.paymentMethod);
  }
}
