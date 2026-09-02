import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOperation,
  ApiHeader,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { RolesGuard } from '../../../common/guards/roles.guard';
import type { User } from '../../../generated/prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TaskerEliteRequestDto } from '../dto';
import { EliteProgramService } from '../services/elite-program.service';
import { RequestLocale } from '../../localization/request-locale.decorator';

@ApiTags('12 Tasker - Elite Program')
@ApiHeader({
  name: 'Accept-Language',
  required: false,
  example: 'ary',
  description: 'Supports en, ar, and ary (Moroccan Darija), with English fallback.',
})
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Tasker)
@Controller('tasker-dashboard/elite')
export class TaskerEliteController {
  constructor(private readonly elite: EliteProgramService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the logged-in Tasker Elite state',
    description:
      'Returns current tier/benefits/badges, one pending request if present, real performance metrics, valid next actions, and a requirements-based eligibility score when the target tier has administrator-configured thresholds.',
  })
  state(
    @CurrentUser() user: User,
    @RequestLocale() locale: string,
  ): Promise<Record<string, unknown>> {
    return this.elite.taskerState(user.id, locale);
  }

  @Post('requests')
  @ApiOperation({
    summary: 'Submit an Elite application, upgrade, or downgrade request',
    description:
      'One request endpoint covers all three flows. Target tier is derived from the active tier order so clients cannot skip tiers. Only one pending request per tasker is allowed.',
  })
  @ApiConflictResponse({
    description: 'Tasker state does not allow this request or another request is already pending.',
  })
  request(
    @CurrentUser() user: User,
    @Body() dto: TaskerEliteRequestDto,
  ): Promise<Record<string, unknown>> {
    return this.elite.submitRequest(user.id, dto);
  }

  @Delete('requests/:requestId')
  @ApiParam({ name: 'requestId', required: true, type: String, description: 'Elite request ID.' })
  @ApiOperation({ summary: 'Cancel the logged-in Tasker own pending Elite request' })
  cancel(
    @CurrentUser() user: User,
    @Param('requestId') requestId: string,
  ): Promise<Record<string, unknown>> {
    return this.elite.cancelTaskerRequest(user.id, requestId);
  }
}
