import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../common/enums/user-role.enum';
import { normalizePagination } from '../../common/utils/pagination.util';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import { ListFavoritesQueryDto } from './favorites.dto';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(customerId: number, query: ListFavoritesQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 20);
    const [rows, totalItems] = await Promise.all([
      this.prisma.favoriteTasker.findMany({
        where: { customerId },
        include: {
          tasker: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profilePicture: true,
              aboutMe: true,
              rating: true,
              reviewsCount: true,
              completedTasks: true,
              isElite: true,
              serviceAreaCity: true,
              serviceAreaArea: true,
              userServices: {
                include: { service: { select: { id: true, name: true, slug: true, icon: true } } },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.favoriteTasker.count({ where: { customerId } }),
    ]);
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => ({
        id: row.id,
        tasker: {
          id: String(row.tasker.id),
          name: `${row.tasker.firstName ?? ''} ${row.tasker.lastName ?? ''}`.trim(),
          profilePicture: row.tasker.profilePicture ?? '',
          aboutMe: row.tasker.aboutMe ?? '',
          rating: Number(row.tasker.rating),
          reviewsCount: row.tasker.reviewsCount,
          completedTasks: row.tasker.completedTasks,
          isElite: row.tasker.isElite,
          location: {
            city: row.tasker.serviceAreaCity,
            area: row.tasker.serviceAreaArea,
          },
          services: row.tasker.userServices.map((item) => ({
            id: String(item.service.id),
            name: item.service.name,
            slug: item.service.slug,
            icon: item.service.icon ?? '',
            hourlyRate: Number(item.hourlyRate),
          })),
        },
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async add(customerId: number, taskerId: number) {
    const tasker = await this.prisma.user.findFirst({
      where: {
        id: taskerId,
        roles: { has: UserRole.Tasker },
        deletedAt: null,
        accountStatus: 'active',
        onboardingStatus: 'approved',
        taskerProfile: { is: { status: 'active' } },
      },
      select: { id: true },
    });
    if (!tasker) throw new NotFoundException('Tasker not found');
    if (customerId === taskerId) throw new ConflictException('You cannot favorite yourself');
    try {
      const favorite = await this.prisma.favoriteTasker.create({
        data: { customerId, taskerId },
      });
      return {
        id: favorite.id,
        taskerId: String(taskerId),
        createdAt: favorite.createdAt.toISOString(),
      };
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('Tasker is already in favorites');
      }
      throw error;
    }
  }

  async remove(customerId: number, taskerId: number): Promise<{ removed: true; taskerId: string }> {
    const result = await this.prisma.favoriteTasker.deleteMany({ where: { customerId, taskerId } });
    if (result.count === 0) throw new NotFoundException('Favorite tasker not found');
    return { removed: true, taskerId: String(taskerId) };
  }
}
