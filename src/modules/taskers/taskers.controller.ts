import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ListTaskersQueryDto } from './dto/list-taskers-query.dto';
import { PublicTaskerReviewsQueryDto } from './dto/public-tasker-reviews-query.dto';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto';
import { TaskerDetailQueryDto } from './dto/tasker-detail-query.dto';
import { TaskerParamDto } from './dto/tasker-param.dto';
import { TaskersService } from './taskers.service';
import { RequestLocale } from '../localization/request-locale.decorator';

@ApiTags('14 Tasker Discovery')
@ApiHeader({
  name: 'Accept-Language',
  required: false,
  example: 'ary',
  description: 'Supports en, ar, and ary (Moroccan Darija), with English fallback.',
})
@Controller('taskers')
export class TaskersController {
  constructor(private readonly taskers: TaskersService) {}

  @Post('onboarding')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.Tasker)
  submitOnboarding(@CurrentUser() user: User, @Body() dto: SubmitOnboardingDto) {
    return this.taskers.submitOnboarding(user.id, dto);
  }

  @Get()
  getTaskers(@Query() query: ListTaskersQueryDto, @RequestLocale() locale: string) {
    return this.taskers.list(query, locale);
  }

  @Get(':id/availability')
  getTaskerAvailability(@Param() params: TaskerParamDto) {
    return this.taskers.getAvailability(params.id);
  }

  @Get(':id/reviews')
  @ApiOperation({ summary: 'List public reviews received by an active tasker' })
  getTaskerReviews(@Param() params: TaskerParamDto, @Query() query: PublicTaskerReviewsQueryDto) {
    return this.taskers.getPublicReviews(params.id, query);
  }

  @Get(':id')
  getTaskerById(
    @Param() params: TaskerParamDto,
    @Query() query: TaskerDetailQueryDto,
    @RequestLocale() locale: string,
  ) {
    return this.taskers.getById(params.id, query.serviceSlug, locale);
  }
}
