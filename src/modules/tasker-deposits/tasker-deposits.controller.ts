import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TaskerDepositsService } from './tasker-deposits.service';

export class AdminDepositActionDto {
  @ApiProperty({ enum: ['mark_paid', 'waive', 'refund'] })
  @IsIn(['mark_paid', 'waive', 'refund'])
  action!: 'mark_paid' | 'waive' | 'refund';

  @ApiPropertyOptional({ description: 'Bank transfer / receipt reference for mark_paid.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AdminListDepositsQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'paid', 'waived', 'refunded'] })
  @IsOptional()
  @IsIn(['pending', 'paid', 'waived', 'refunded'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@ApiTags('61 Tasker Signup Deposit')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Tasker)
@Controller('tasker-dashboard/deposit')
export class TaskerDepositController {
  constructor(private readonly deposits: TaskerDepositsService) {}

  @Get()
  @ApiOperation({
    summary: 'My signup deposit status',
    description:
      'required=false when the platform has no deposit policy. When required and not satisfied, pay it via POST /api/payments/cmi/checkout { purpose: "tasker_deposit" } (or an admin records a bank transfer). Admin approval of the application is blocked until it is paid or waived.',
  })
  get(@CurrentUser() user: User) {
    return this.deposits.taskerView(user.id);
  }
}

@ApiTags('61 Tasker Signup Deposit')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin')
export class AdminTaskerDepositsController {
  constructor(private readonly deposits: TaskerDepositsService) {}

  @Get('tasker-deposits')
  @Permissions('finance.read')
  @ApiOperation({ summary: 'All Tasker signup deposits' })
  list(@Query() query: AdminListDepositsQueryDto) {
    return this.deposits.adminList(query);
  }

  @Get('taskers/:taskerId/deposit')
  @Permissions('taskers.read')
  @ApiParam({ name: 'taskerId', type: Number })
  get(@Param('taskerId', ParseIntPipe) taskerId: number) {
    return this.deposits.adminForTasker(taskerId);
  }

  @Post('taskers/:taskerId/deposit/actions')
  @Permissions('finance.manage')
  @ApiParam({ name: 'taskerId', type: Number })
  @ApiOperation({ summary: 'Record an off-platform payment (mark_paid), waive, or mark refunded. Audited.' })
  action(@CurrentUser() actor: User, @Param('taskerId', ParseIntPipe) taskerId: number, @Body() dto: AdminDepositActionDto) {
    return this.deposits.adminAction(actor, taskerId, dto);
  }
}
