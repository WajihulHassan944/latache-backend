import { Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FavoriteTaskerParamDto, ListFavoritesQueryDto } from './favorites.dto';
import { FavoritesService } from './favorites.service';

@ApiTags('11 Favorites')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Customer)
@Controller('favorites/taskers')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'List the authenticated customer favorite taskers' })
  list(@CurrentUser() user: User, @Query() query: ListFavoritesQueryDto) {
    return this.favorites.list(user.id, query);
  }

  @Post(':taskerId')
  @ApiParam({ name: 'taskerId', required: true, type: Number, description: 'Tasker user ID to favorite.' })
  @ApiOperation({ summary: 'Add a tasker to favorites' })
  add(@CurrentUser() user: User, @Param() params: FavoriteTaskerParamDto) {
    return this.favorites.add(user.id, params.taskerId);
  }

  @Delete(':taskerId')
  @ApiParam({ name: 'taskerId', required: true, type: Number, description: 'Tasker user ID to remove from favorites.' })
  @ApiOperation({ summary: 'Remove a tasker from favorites' })
  remove(@CurrentUser() user: User, @Param() params: FavoriteTaskerParamDto) {
    return this.favorites.remove(user.id, params.taskerId);
  }
}
