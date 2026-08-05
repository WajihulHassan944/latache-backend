import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { CreateServiceDto } from './dto/create-service.dto';
import { ListServicesQueryDto } from './dto/list-services-query.dto';
import { ServicesService } from './services.service';

@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get('get-services')
  getServices(@Query() query: ListServicesQueryDto) {
    return this.services.list(query);
  }

  @Post('add-service')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(AdminAuthGuard)
  addService(@Body() dto: CreateServiceDto) {
    return this.services.create(dto);
  }
}
