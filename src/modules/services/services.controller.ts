import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { User } from '../../generated/prisma/client';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { CreateServiceDto, UpdateServiceDto } from './dto/create-service.dto';
import { ListServicesQueryDto } from './dto/list-services-query.dto';
import {
  CreateServiceOptionDto,
  ServiceIdParamDto,
  ServiceOptionParamDto,
  UpdateServiceOptionDto,
} from './dto/service-option.dto';
import { ServicesService } from './services.service';
import { RequestLocale } from '../localization/request-locale.decorator';

@ApiTags('13 Services')
@ApiHeader({
  name: 'Accept-Language',
  required: false,
  description:
    'Requested dynamic-content locale (en, ar, or ary for Moroccan Darija). An authenticated saved preference takes priority; missing translations fall back to English, then canonical content.',
  example: 'ary-MA',
})
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'List active service categories for customer/tasker flows',
    description:
      'Inactive categories are intentionally hidden from new discovery and booking flows.',
  })
  getServices(
    @Query() query: ListServicesQueryDto,
    @RequestLocale() locale: string,
  ): Promise<unknown> {
    return this.services.list(query, locale);
  }

  @Get(':serviceId/options')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiParam({ name: 'serviceId', required: true, type: Number, description: 'Service category ID.' })
  @ApiOperation({
    summary: 'List active booking options for a service',
    description:
      'Returns an empty array when the service has no configured sub-options; no design placeholder data is fabricated.',
  })
  serviceOptions(
    @Param() params: ServiceIdParamDto,
    @RequestLocale() locale: string,
  ): Promise<unknown> {
    return this.services.listOptions(params.serviceId, locale);
  }

  @Get(':serviceId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiParam({ name: 'serviceId', required: true, type: Number, description: 'Service category ID.' })
  @ApiOperation({
    summary: 'Get one active service category with its active booking options',
    description:
      'This is the canonical customer/tasker service-detail read. Super Admin/Admin manage the same resource through POST/PATCH/DELETE on /api/services.',
  })
  getService(
    @Param() params: ServiceIdParamDto,
    @RequestLocale() locale: string,
  ): Promise<unknown> {
    return this.services.get(params.serviceId, locale);
  }

  @Post(':serviceId/options')
  @ApiBearerAuth('bearer')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('services.manage')
  @ApiParam({ name: 'serviceId', required: true, type: Number, description: 'Service category ID.' })
  @ApiOperation({
    summary: 'Create a persistent service sub-service/booking option',
    description:
      'Creates the canonical English option and optional translations[] locale rows on the same ServiceOption resource.',
  })
  addServiceOption(
    @CurrentUser() actor: User,
    @Param() params: ServiceIdParamDto,
    @Body() dto: CreateServiceOptionDto,
  ): Promise<unknown> {
    return this.services.createOption(actor, params.serviceId, dto);
  }

  @Patch(':serviceId/options/:optionId')
  @ApiBearerAuth('bearer')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('services.manage')
  @ApiParam({ name: 'serviceId', required: true, type: Number, description: 'Service category ID.' })
  @ApiParam({ name: 'optionId', required: true, type: Number, description: 'Service option ID.' })
  @ApiOperation({ summary: 'Update a persistent service sub-service/booking option' })
  updateServiceOption(
    @CurrentUser() actor: User,
    @Param() params: ServiceOptionParamDto,
    @Body() dto: UpdateServiceOptionDto,
  ): Promise<unknown> {
    return this.services.updateOption(actor, params.serviceId, params.optionId, dto);
  }

  @Delete(':serviceId/options/:optionId')
  @ApiBearerAuth('bearer')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('services.manage')
  @ApiParam({ name: 'serviceId', required: true, type: Number, description: 'Service category ID.' })
  @ApiParam({ name: 'optionId', required: true, type: Number, description: 'Service option ID.' })
  @ApiOperation({
    summary: 'Permanently delete an unused service option',
    description:
      'Irreversible deletion. Existing booking references block the operation and return SERVICE_OPTION_PURGE_BLOCKED.',
  })
  @ApiConflictResponse({ description: 'SERVICE_OPTION_PURGE_BLOCKED with booking count.' })
  deleteServiceOption(
    @CurrentUser() actor: User,
    @Param() params: ServiceOptionParamDto,
  ): Promise<unknown> {
    return this.services.deleteOption(actor, params.serviceId, params.optionId);
  }

  @Post()
  @ApiBearerAuth('bearer')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('services.manage')
  @ApiOperation({
    summary: 'Create a service catalogue category',
    description:
      'The current Services table remains the canonical resource. name/description are required English fallback values; optional translations[] adds configured locales such as ar.',
  })
  @ApiForbiddenResponse({ description: 'Administrator lacks services.manage.' })
  addService(@CurrentUser() actor: User, @Body() dto: CreateServiceDto): Promise<unknown> {
    return this.services.create(actor, dto);
  }

  @Patch(':serviceId')
  @ApiBearerAuth('bearer')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('services.manage')
  @ApiParam({ name: 'serviceId', required: true, type: Number, description: 'Service category ID.' })
  @ApiOperation({
    summary: 'Update a service category',
    description:
      'Allows canonical English content, translations[], slug, image/icon, ordering and active-state changes. Locale rows are upserted; existing bookings and IDs are never rewritten.',
  })
  updateService(
    @CurrentUser() actor: User,
    @Param() params: ServiceIdParamDto,
    @Body() dto: UpdateServiceDto,
  ): Promise<unknown> {
    return this.services.update(actor, params.serviceId, dto);
  }

  @Delete(':serviceId')
  @ApiBearerAuth('bearer')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('services.manage')
  @ApiParam({ name: 'serviceId', required: true, type: Number, description: 'Service category ID.' })
  @ApiOperation({
    summary: 'Permanently delete an unused service category',
    description:
      'Irreversible deletion of the canonical service, options, translations, tasker assignments and managed image. Existing booking history blocks deletion and returns SERVICE_PURGE_BLOCKED.',
  })
  @ApiConflictResponse({ description: 'SERVICE_PURGE_BLOCKED with booking count.' })
  deleteService(@CurrentUser() actor: User, @Param() params: ServiceIdParamDto): Promise<unknown> {
    return this.services.delete(actor, params.serviceId);
  }
}
