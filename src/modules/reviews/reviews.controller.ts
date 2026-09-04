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
import { ApiBearerAuth, ApiConflictResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateReviewDto,
  ListReviewsQueryDto,
  ReviewBookingParamDto,
  ReviewIdParamDto,
  UpdateReviewDto,
} from './reviews.dto';
import { ReviewsService } from './reviews.service';
import type { ReviewListView, ReviewView } from './reviews.types';

@ApiTags('10 Reviews')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Customer, UserRole.Tasker)
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({
    summary: 'List reviews received or given by the authenticated customer/tasker',
    description: 'One role-aware endpoint powers both customer and tasker review screens.',
  })
  list(@CurrentUser() user: User, @Query() query: ListReviewsQueryDto): Promise<ReviewListView> {
    return this.reviews.list(user.id, user.role as UserRole.Customer | UserRole.Tasker, query);
  }

  @Post('bookings/:bookingId')
  @ApiParam({ name: 'bookingId', required: true, type: Number, description: 'Booking ID.' })
  @ApiOperation({
    summary: 'Review the other participant after a completed booking',
    description:
      'Customers review taskers and taskers review customers through the same endpoint. One review per booking per reviewer is enforced.',
  })
  @ApiConflictResponse({ description: 'This booking has already been reviewed by the caller.' })
  create(
    @CurrentUser() user: User,
    @Param() params: ReviewBookingParamDto,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewView> {
    return this.reviews.create(user, params.bookingId, dto);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Review ID.' })
  @ApiOperation({ summary: 'Edit an authored review' })
  update(
    @CurrentUser() user: User,
    @Param() params: ReviewIdParamDto,
    @Body() dto: UpdateReviewDto,
  ): Promise<ReviewView> {
    return this.reviews.update(user, params.id, dto);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', required: true, type: String, description: 'Review ID.' })
  @ApiOperation({ summary: 'Delete an authored review' })
  delete(
    @CurrentUser() user: User,
    @Param() params: ReviewIdParamDto,
  ): Promise<{ deleted: true; id: string }> {
    return this.reviews.delete(user, params.id);
  }
}
