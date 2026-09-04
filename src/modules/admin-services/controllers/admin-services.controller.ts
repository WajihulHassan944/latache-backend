import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import type { User } from '../../../generated/prisma/client';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import { AdminServicesQueryDto } from '../dto/admin-services.dto';
import { AdminServicesService } from '../services/admin-services.service';

@ApiTags('60 Admin - Service Management')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'A valid administrator session is required.' })
@ApiForbiddenResponse({ description: 'The administrator lacks services.read.' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/services')
export class AdminServicesController {
  constructor(private readonly adminServices: AdminServicesService) {}

  @Get()
  @Permissions('services.read')
  @ApiOperation({
    summary: 'Unified Service Management dashboard read API',
    description:
      'Use view=catalog for category/sub-service/active-Tasker metrics, including all configured translations, view=pricing for the existing commission/tax/Elite pricing policy, and view=icons for the curated list of valid Service.icon values (value + display label) to populate the create/edit-service icon picker. Category/sub-service and translation mutations deliberately reuse /api/services/*; pricing mutations reuse /api/admin/platform-settings. view=pricing additionally requires settings.read for non-super-admin users.',
  })
  @ApiOkResponse({
    description:
      'Service-management catalogue or pricing view generated from persisted Latache data.',
  })
  read(
    @CurrentUser() actor: User,
    @Query() query: AdminServicesQueryDto,
  ): Promise<Record<string, unknown>> {
    if (
      query.view === 'pricing' &&
      actor.role !== UserRole.SuperAdmin &&
      !actor.permissions.includes('settings.read')
    ) {
      throw new ForbiddenException(
        'settings.read is required for the Service Management pricing view',
      );
    }
    return this.adminServices.read(query);
  }

  @Get(':serviceId')
  @Permissions('services.read')
  @ApiParam({ name: 'serviceId', required: true, type: Number, description: 'Service category ID.' })
  @ApiOperation({
    summary: 'Get one service category with sub-services, Tasker assignments and booking usage',
    description:
      'This administrator aggregate returns all Service and Service Option translations. Tasker skill/rate mutation remains owned by the existing Tasker profile/onboarding flow.',
  })
  detail(@Param('serviceId', ParseIntPipe) serviceId: number): Promise<Record<string, unknown>> {
    return this.adminServices.detail(serviceId);
  }
}
