import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { RolesGuard } from '../../../common/guards/roles.guard';
import type { User } from '../../../generated/prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { TaskerBusinessProfileView, TaskerSkillView } from '../tasker-dashboard.contracts';
import {
  ActivateTaskerSkillDto,
  NumericIdParamDto,
  UpdateTaskerBusinessProfileDto,
  UpdateTaskerSkillDto,
} from '../dto';
import { TaskerProfileService } from '../services/tasker-profile.service';

@ApiTags('12 Tasker Profile & Skills')
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
  @ApiOperation({
    summary: 'Get the complete service catalogue with tasker skill activation state',
  })
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
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Service ID of the activated skill.' })
  @ApiOperation({ summary: 'Update an active skill hourly rate' })
  updateSkill(
    @CurrentUser() user: User,
    @Param() params: NumericIdParamDto,
    @Body() dto: UpdateTaskerSkillDto,
  ): Promise<TaskerSkillView> {
    return this.profile.updateSkill(user.id, params.id, dto);
  }

  @Delete('skills/:id')
  @ApiParam({ name: 'id', required: true, type: Number, description: 'Service ID of the activated skill.' })
  @ApiOperation({ summary: 'Permanently remove a Tasker skill assignment' })
  @ApiConflictResponse({ description: 'Active bookings still depend on this skill.' })
  deleteSkill(
    @CurrentUser() user: User,
    @Param() params: NumericIdParamDto,
  ): Promise<{ deleted: true; serviceId: string }> {
    return this.profile.deleteSkill(user.id, params.id);
  }

  @Delete()
  @ApiOperation({
    summary: 'Deactivate the tasker account safely',
    description:
      'This is a Tasker-profile lifecycle action, not identity deletion: it deactivates only the Tasker role and revokes Tasker sessions without affecting an enabled Customer profile or erasing financial history. Administrators use the explicit permanent-delete control for eligible accounts.',
  })
  @ApiOkResponse({ description: 'Tasker account deactivated.' })
  @ApiConflictResponse({ description: 'Operational or financial obligations remain.' })
  deactivateAccount(@CurrentUser() user: User): Promise<{ deactivated: true }> {
    return this.profile.deactivateAccount(user.id);
  }
}
