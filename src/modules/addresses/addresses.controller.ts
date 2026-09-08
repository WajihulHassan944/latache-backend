import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddressParamDto, CreateAddressDto, UpdateAddressDto } from './addresses.dto';
import { AddressesService } from './addresses.service';

@ApiTags('22 Saved Addresses')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Customer)
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ApiOperation({ summary: 'List the authenticated customer saved addresses' })
  list(@CurrentUser() user: User) {
    return this.addresses.list(user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Save a new customer address',
    description:
      'The first saved address is always made the default; isDefault=true on any later address unsets the previous default.',
  })
  create(@CurrentUser() user: User, @Body() dto: CreateAddressDto) {
    return this.addresses.create(user.id, dto);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Saved address ID.' })
  @ApiOperation({ summary: 'Update a saved address' })
  update(
    @CurrentUser() user: User,
    @Param() params: AddressParamDto,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addresses.update(user.id, params.id, dto);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Saved address ID.' })
  @ApiOperation({
    summary: 'Delete a saved address',
    description:
      'If the deleted address was the default, the next-oldest remaining address (if any) is promoted to default.',
  })
  remove(@CurrentUser() user: User, @Param() params: AddressParamDto) {
    return this.addresses.delete(user.id, params.id);
  }
}
