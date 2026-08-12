import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import type { User } from '../../../generated/prisma/client';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import {
  AdminCustomerBookingsQueryDto,
  AdminCustomerPaymentsQueryDto,
  AdminDateRangeQueryDto,
  AdminUserModerationDto,
  ListAdminCustomersDto,
} from '../dto';
import { AdminCustomersService } from '../services/admin-customers.service';

@ApiTags('21 Admin Dashboard - Customers')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'A valid active administrator session is required.' })
@ApiForbiddenResponse({ description: 'The administrator lacks the required permission.' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly customers: AdminCustomersService) {}

  @Get()
  @Permissions('customers.read')
  @ApiOperation({ summary: 'List and search customers for Customer Management' })
  list(@Query() query: ListAdminCustomersDto) {
    return this.customers.list(query);
  }

  @Get('payments')
  @Permissions('customers.read', 'finance.read')
  @ApiOperation({
    summary: 'Admin-wide payment history',
    description:
      'Reports persisted payment transactions and disputed booking amounts. Values come from Stripe/wallet settlement records rather than mock dashboard totals.',
  })
  allPayments(@Query() query: AdminCustomerPaymentsQueryDto) {
    return this.customers.allPayments(query);
  }

  @Get('reports')
  @Permissions('customers.read', 'reports.read')
  @ApiOperation({ summary: 'Customer reports, status breakdown and top customers by real spend' })
  reports(@Query() query: AdminDateRangeQueryDto) {
    return this.customers.reports(query);
  }

  @Get(':id')
  @Permissions('customers.read')
  @ApiParam({ name: 'id', type: Number, example: 42 })
  @ApiOperation({ summary: 'Get one customer profile and operational summary' })
  @ApiNotFoundResponse({ description: 'Customer not found.' })
  details(@Param('id', ParseIntPipe) id: number) {
    return this.customers.details(id);
  }

  @Get(':id/bookings')
  @Permissions('customers.read', 'bookings.read')
  @ApiOperation({ summary: 'Get one customer booking history' })
  bookings(@Param('id', ParseIntPipe) id: number, @Query() query: AdminCustomerBookingsQueryDto) {
    return this.customers.bookings(id, query);
  }

  @Get(':id/payments')
  @Permissions('customers.read', 'finance.read')
  @ApiOperation({ summary: 'Get one customer payment history' })
  payments(@Param('id', ParseIntPipe) id: number, @Query() query: AdminCustomerPaymentsQueryDto) {
    return this.customers.payments(id, query);
  }

  @Patch(':id/status')
  @Permissions('customers.manage')
  @ApiOperation({
    summary: 'Suspend, reactivate or ban/deactivate a customer',
    description:
      'Suspension and ban revoke all active sessions and create an immutable administrative audit event. Ban maps to the existing deactivated account state. Reactivating a banned/deactivated customer is super-admin-only.',
  })
  @ApiOkResponse({ description: 'Customer account state updated.' })
  moderate(
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminUserModerationDto,
  ) {
    return this.customers.moderate(actor, id, dto);
  }
}
