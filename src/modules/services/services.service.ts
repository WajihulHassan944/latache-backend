import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import type { Service } from '../../generated/prisma/client';
import { CreateServiceDto } from './dto/create-service.dto';
import { ListServicesQueryDto } from './dto/list-services-query.dto';
import { CreateServiceOptionDto, UpdateServiceOptionDto } from './dto/service-option.dto';

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

    const [totalItems, rows] = await Promise.all([
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

  async listOptions(serviceId: number) {
    const exists = await this.prisma.service.count({ where: { id: serviceId } });
    if (!exists) throw new NotFoundException('Service not found');
    const rows = await this.prisma.serviceOption.findMany({
      where: { serviceId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => this.serializeOption(row));
  }

  async createOption(serviceId: number, dto: CreateServiceOptionDto) {
    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('Service not found');
    try {
      return this.serializeOption(await this.prisma.serviceOption.create({
        data: {
          serviceId,
          name: dto.name,
          slug: dto.slug,
          description: dto.description ?? null,
          sortOrder: dto.sortOrder ?? 0,
        },
      }));
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'P2002') throw new ConflictException('Service option slug already exists for this service');
      throw error;
    }
  }

  async updateOption(serviceId: number, optionId: number, dto: UpdateServiceOptionDto) {
    const option = await this.prisma.serviceOption.findFirst({ where: { id: optionId, serviceId } });
    if (!option) throw new NotFoundException('Service option not found');
    return this.serializeOption(await this.prisma.serviceOption.update({
      where: { id: optionId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    }));
  }

  async deactivateOption(serviceId: number, optionId: number): Promise<{ deactivated: true; id: string }> {
    const result = await this.prisma.serviceOption.updateMany({
      where: { id: optionId, serviceId, isActive: true },
      data: { isActive: false },
    });
    if (result.count === 0) throw new NotFoundException('Active service option not found');
    return { deactivated: true, id: String(optionId) };
  }

  private serializeOption(option: { id: number; serviceId: number; name: string; slug: string; description: string | null; isActive: boolean; sortOrder: number }) {
    return {
      id: String(option.id),
      serviceId: String(option.serviceId),
      name: option.name,
      slug: option.slug,
      description: option.description,
      isActive: option.isActive,
      sortOrder: option.sortOrder,
    };
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
