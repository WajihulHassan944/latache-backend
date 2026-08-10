import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { CreateServiceDto } from './dto/create-service.dto';
import { ListServicesQueryDto } from './dto/list-services-query.dto';
import { CreateServiceOptionDto, ServiceIdParamDto, ServiceOptionParamDto, UpdateServiceOptionDto } from './dto/service-option.dto';
import { ServicesService } from './services.service';

@ApiTags('13 Services')
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get('get-services')
  getServices(@Query() query: ListServicesQueryDto) {
    return this.services.list(query);
  }

  @Get(':serviceId/options')
  @ApiOperation({ summary: 'List active booking options for a service', description: 'Returns an empty array when the service has no configured sub-options; no design placeholder data is fabricated.' })
  serviceOptions(@Param() params: ServiceIdParamDto) {
    return this.services.listOptions(params.serviceId);
  }

  @Post(':serviceId/options')
  @ApiBearerAuth('bearer')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('services.manage')
  @ApiOperation({ summary: 'Create a persistent service booking option' })
  addServiceOption(@Param() params: ServiceIdParamDto, @Body() dto: CreateServiceOptionDto) {
    return this.services.createOption(params.serviceId, dto);
  }

  @Patch(':serviceId/options/:optionId')
  @ApiBearerAuth('bearer')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('services.manage')
  @ApiOperation({ summary: 'Update a persistent service booking option' })
  updateServiceOption(@Param() params: ServiceOptionParamDto, @Body() dto: UpdateServiceOptionDto) {
    return this.services.updateOption(params.serviceId, params.optionId, dto);
  }

  @Delete(':serviceId/options/:optionId')
  @ApiBearerAuth('bearer')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('services.manage')
  @ApiOperation({ summary: 'Deactivate a service option', description: 'Existing bookings keep their historical option reference; the option is hidden from future booking flows.' })
  deleteServiceOption(@Param() params: ServiceOptionParamDto) {
    return this.services.deactivateOption(params.serviceId, params.optionId);
  }

  @Post('add-service')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('services.manage')
  @ApiOperation({ summary: 'Create a service catalogue entry', description: 'Requires services.manage; super admin bypasses permission checks.' })
  @ApiForbiddenResponse({ description: 'Administrator lacks services.manage.' })
  addService(@Body() dto: CreateServiceDto) {
    return this.services.create(dto);
  }
}
