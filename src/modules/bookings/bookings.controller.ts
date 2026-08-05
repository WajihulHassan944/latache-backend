import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BookingsService } from './bookings.service';
import { BookTaskerDto } from './dto/book-tasker.dto';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto';

@ApiTags('bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post('book-tasker')
  bookTasker(@CurrentUser() user: User, @Body() dto: BookTaskerDto) {
    return this.bookings.book(user.id, dto);
  }

  @Get('upcoming')
  getUpcoming(@CurrentUser() user: User, @Query() query: ListBookingsQueryDto) {
    return this.bookings.getUpcoming(user.id, query);
  }

  @Get('completed')
  getCompleted(@CurrentUser() user: User, @Query() query: ListBookingsQueryDto) {
    return this.bookings.getCompleted(user.id, query);
  }

  @Get('next')
  getNext(@CurrentUser() user: User) {
    return this.bookings.getNext(user.id);
  }
}
