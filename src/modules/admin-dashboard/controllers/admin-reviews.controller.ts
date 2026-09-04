import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import type { User } from '../../../generated/prisma/client';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import { AdminReviewModerationDto, AdminReviewsQueryDto } from '../dto/admin-reviews.dto';
import { AdminReviewsService } from '../services/admin-reviews.service';

@ApiTags('62 Admin - Review Moderation')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly reviews: AdminReviewsService) {}

  @Get()
  @Permissions('reviews.read')
  @ApiOperation({
    summary: 'List and search platform reviews with moderation state',
    description:
      'Public/user review reads remain on /api/reviews and /api/taskers/:id/reviews. This endpoint is only the administrative moderation view.',
  })
  list(@Query() query: AdminReviewsQueryDto) {
    return this.reviews.list(query);
  }

  @Patch(':reviewId/moderation')
  @Permissions('reviews.manage')
  @ApiParam({ name: 'reviewId', required: true, type: String, description: 'Review ID.' })
  @ApiOperation({
    summary: 'Hide or restore a review without rewriting author content',
    description:
      'Hidden reviews are excluded from public/received review feeds and rating aggregates. The original review remains auditable.',
  })
  moderate(
    @CurrentUser() actor: User,
    @Param('reviewId') reviewId: string,
    @Body() dto: AdminReviewModerationDto,
  ) {
    return this.reviews.moderate(actor, reviewId, dto);
  }
}
