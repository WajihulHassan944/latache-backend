import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { RolesGuard } from '../../../common/guards/roles.guard';
import type { User } from '../../../generated/prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type {
  TaskerBusinessProfileView,
  TaskerSkillView,
} from '../tasker-dashboard.contracts';
import {
  ActivateTaskerSkillDto,
  NumericIdParamDto,
  UpdateTaskerBusinessProfileDto,
  UpdateTaskerSkillDto,
} from '../dto';
import { TaskerProfileService } from '../services/tasker-profile.service';

@ApiTags('11 Tasker Profile & Skills')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Tasker)
@Controller('tasker-dashboard/profile')
export class TaskerProfileController {
  constructor(private readonly profile: TaskerProfileService) {}

  // Common personal fields are intentionally served by GET/PATCH /api/auth/me for every role.

  @Get('business')
  @ApiOperation({ summary: 'Get tasker business/profile visibility information' })
  business(@CurrentUser() user: User): Promise<TaskerBusinessProfileView> {
    return this.profile.business(user.id);
  }

  @Patch('business')
  @ApiOperation({ summary: 'Update tasker business/profile visibility information' })
  updateBusiness(
    @CurrentUser() user: User,
    @Body() dto: UpdateTaskerBusinessProfileDto,
  ): Promise<TaskerBusinessProfileView> {
    return this.profile.updateBusiness(user.id, dto);
  }

  @Get('skills')
  @ApiOperation({ summary: 'Get the complete service catalogue with tasker skill activation state' })
  skills(@CurrentUser() user: User): Promise<TaskerSkillView[]> {
    return this.profile.listSkills(user.id);
  }

  @Post('skills')
  @ApiOperation({ summary: 'Activate a service skill and set its hourly rate' })
  activateSkill(
    @CurrentUser() user: User,
    @Body() dto: ActivateTaskerSkillDto,
  ): Promise<TaskerSkillView> {
    return this.profile.activateSkill(user.id, dto);
  }

  @Patch('skills/:id')
  @ApiOperation({ summary: 'Update an active skill hourly rate' })
  updateSkill(
    @CurrentUser() user: User,
    @Param() params: NumericIdParamDto,
    @Body() dto: UpdateTaskerSkillDto,
  ): Promise<TaskerSkillView> {
    return this.profile.updateSkill(user.id, params.id, dto);
  }

  @Delete('skills/:id')
  @ApiOperation({ summary: 'Deactivate a tasker skill' })
  @ApiConflictResponse({ description: 'Active bookings still depend on this skill.' })
  deactivateSkill(
    @CurrentUser() user: User,
    @Param() params: NumericIdParamDto,
  ): Promise<{ deactivated: true; serviceId: string }> {
    return this.profile.deactivateSkill(user.id, params.id);
  }

  @Delete()
  @ApiOperation({
    summary: 'Deactivate the tasker account safely',
    description:
      'Blocks deactivation while active tasks, wallet balances, or pending withdrawals exist. Revokes all active sessions on success.',
  })
  @ApiOkResponse({ description: 'Tasker account deactivated.' })
  @ApiConflictResponse({ description: 'Operational or financial obligations remain.' })
  deactivateAccount(@CurrentUser() user: User): Promise<{ deactivated: true }> {
    return this.profile.deactivateAccount(user.id);
  }
}
