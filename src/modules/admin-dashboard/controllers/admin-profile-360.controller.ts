import { Controller, Get, Param, ParseIntPipe, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { User } from '../../../generated/prisma/client';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import { AdminProfile360Service } from '../services/admin-profile-360.service';

@ApiTags('63 Admin - Profile 360')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard)
@Controller('admin/profile-360')
export class AdminProfile360Controller {
  constructor(private readonly profile: AdminProfile360Service) {}

  @Get(':userId')
  @ApiParam({ name: 'userId', type: Number, description: 'Customer or Tasker user ID.' })
  @ApiQuery({ name: 'role', enum: ['customer', 'tasker'], required: true })
  @ApiOperation({
    summary: 'Full 360 profile of a customer or Tasker',
    description:
      'Identity, lifetime stats (incl. Tasker total earnings), all bookings, payments, reviews, activity timeline and chat history with booking event cards. Needs customers.read or taskers.read; chats additionally need conversations.read. Opening it is audit logged.',
  })
  @ApiOkResponse({ description: '360 profile.' })
  get(@CurrentUser() actor: User, @Param('userId', ParseIntPipe) userId: number, @Query('role') role: string) {
    if (role !== 'customer' && role !== 'tasker') throw new BadRequestException('role must be customer or tasker');
    return this.profile.get(actor, userId, role);
  }
}
