import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TaskerDashboardService } from '../tasker-dashboard/services/tasker-dashboard.service';
import { CustomerDashboardService } from './customer-dashboard.service';

@ApiTags('04 Dashboard')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly customerDashboard: CustomerDashboardService,
    private readonly taskerDashboard: TaskerDashboardService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Get the dashboard overview for the current user role',
    description:
      'The same endpoint serves customer and tasker dashboards. Administrators use the admin/RBAC surfaces instead.',
  })
  overview(@CurrentUser() user: User) {
    if (user.role === UserRole.Customer) return this.customerDashboard.overview(user.id);
    if (user.role === UserRole.Tasker) return this.taskerDashboard.overview(user.id);
    throw new ForbiddenException('Dashboard overview is available to customers and taskers');
  }
}
