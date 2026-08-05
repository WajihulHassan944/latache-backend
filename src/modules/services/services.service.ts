import { ConflictException, Injectable } from '@nestjs/common';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import type { Service } from '../../generated/prisma/client';
import { CreateServiceDto } from './dto/create-service.dto';
import { ListServicesQueryDto } from './dto/list-services-query.dto';

export interface ServiceResponse {
  id: string;
  name: string | null;
  description: string | null;
  icon: string;
  slug: string | null;
}

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListServicesQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 10);
    const search = query.search?.trim();
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { description: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [totalItems, rows] = await this.prisma.$transaction([
      this.prisma.service.count({ where }),
      this.prisma.service.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: { id: 'asc' },
      }),
    ]);

    return {
      items: rows.map((service) => this.serialize(service)),
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    };
  }

  async create(dto: CreateServiceDto): Promise<ServiceResponse> {
    const service = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`latache-service:${dto.slug.toLowerCase()}`}))
      `;
      const existing = await transaction.service.findFirst({
        where: { slug: { equals: dto.slug, mode: 'insensitive' } },
      });
      if (existing) throw new ConflictException('Service slug already exists');
      const now = new Date();
      return transaction.service.create({
        data: { ...dto, createdAt: now, updatedAt: now },
      });
    });
    return this.serialize(service);
  }

  private serialize(service: Service): ServiceResponse {
    return {
      id: service.id.toString(),
      name: service.name,
      description: service.description,
      icon: service.icon ?? '',
      slug: service.slug,
    };
  }
}
