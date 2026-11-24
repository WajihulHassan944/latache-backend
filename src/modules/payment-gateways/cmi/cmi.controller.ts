import { Body, Controller, Get, Header, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { RolesGuard } from '../../../common/guards/roles.guard';
import type { User } from '../../../generated/prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CmiService, type CmiPurpose } from './cmi.service';

export class CmiCheckoutDto {
  @ApiProperty({
    enum: ['wallet_topup', 'booking', 'tasker_deposit'],
    description:
      'booking: pays an awaiting_payment booking (only the part the wallet does not already cover). wallet_topup: adds funds. tasker_deposit: the Tasker signup deposit.',
  })
  @IsIn(['wallet_topup', 'booking', 'tasker_deposit'])
  purpose!: CmiPurpose;

  @ApiPropertyOptional({ description: 'Required for wallet_topup.', example: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100000)
  amount?: number;

  @ApiPropertyOptional({ description: 'Required for booking.', example: 72 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookingId?: number;
}

@ApiTags('62 Payments - CMI')
@Controller('payments/cmi')
export class CmiController {
  constructor(private readonly cmi: CmiService) {}

  @Get('status')
  @ApiOperation({ summary: 'Whether CMI is enabled, and in which mode' })
  status() {
    return this.cmi.status();
  }

  @Post('checkout')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.Customer, UserRole.Tasker)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Start a CMI card payment',
    description:
      'Returns { url, method: "POST", fields }: render a hidden form with these fields and auto-submit it to url (CMI hosted card page, 3-D Secure). The result arrives server-to-server; poll GET /payments/cmi/orders/:orderId.',
  })
  checkout(@CurrentUser() user: User, @Body() dto: CmiCheckoutDto) {
    return this.cmi.checkout(user, dto);
  }

  @Get('orders/:orderId')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.Customer, UserRole.Tasker)
  @ApiParam({ name: 'orderId', type: String })
  @ApiOperation({ summary: 'Poll a CMI payment: initiated | succeeded | failed' })
  order(@CurrentUser() user: User, @Param('orderId') orderId: string) {
    return this.cmi.order(user, orderId);
  }

  /** Called by CMI (form-urlencoded). Hash-verified; answers in CMI's plain-text protocol. */
  @Post('callback')
  @HttpCode(200)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiExcludeEndpoint()
  callback(@Body() body: Record<string, unknown>) {
    return this.cmi.handleCallback(body);
  }

  @Post('return/ok')
  @ApiExcludeEndpoint()
  returnOk(@Body() body: Record<string, unknown>, @Res() res: Response) {
    res.redirect(303, this.cmi.returnRedirect('ok', body));
  }

  @Post('return/fail')
  @ApiExcludeEndpoint()
  returnFail(@Body() body: Record<string, unknown>, @Res() res: Response) {
    res.redirect(303, this.cmi.returnRedirect('fail', body));
  }

  @Post('simulator')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiExcludeEndpoint()
  simulator(@Body() body: Record<string, unknown>) {
    return this.cmi.simulatorPage(body);
  }

  @Post('simulator/complete')
  @ApiExcludeEndpoint()
  async simulatorComplete(@Body() body: Record<string, unknown>, @Res() res: Response) {
    res.redirect(303, await this.cmi.simulatorComplete(body));
  }
}
