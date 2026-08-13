import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma, Service, User } from '../../generated/prisma/client';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { CreateServiceDto, UpdateServiceDto } from './dto/create-service.dto';
import { ListServicesQueryDto } from './dto/list-services-query.dto';
import { CreateServiceOptionDto, UpdateServiceOptionDto } from './dto/service-option.dto';
import { LocaleService } from '../localization/locale.service';
import type { TranslationDto } from '../localization/translation.dto';
import { ConfigService } from '@nestjs/config';
import { AppCacheService, CacheNamespace } from '../../infrastructure/redis/app-cache.service';
import { ObjectStorageDeletionService } from '../account-deletion/object-storage-deletion.service';

export interface ServiceResponse {
  id: string;
  name: string | null;
  description: string | null;
  icon: string;
  slug: string | null;
  isActive: boolean;
  sortOrder: number;
  resolvedLocale?: string;
  translationFallback?: boolean;
  translations?: TranslationRow[];
}

interface TranslationRow {
  locale: string;
  name: string;
  description: string | null;
}

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly locales: LocaleService,
    private readonly cache: AppCacheService,
    private readonly config: ConfigService,
    private readonly storage: ObjectStorageDeletionService,
  ) {}

  async list(query: ListServicesQueryDto, locale: string) {
    return this.cache.getOrLoad(
      CacheNamespace.Services,
      { operation: 'list', locale, query },
      this.config.get<number>('cache.servicesTtlSeconds', 300),
      () => this.loadList(query, locale),
    );
  }

  private async loadList(query: ListServicesQueryDto, locale: string) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 10);
    const search = query.search?.trim();
    const normalizedSearch = search ? this.locales.normalizeSearchText(search) : undefined;
    const where: Prisma.ServiceWhereInput = {
      isActive: true,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { description: { contains: search, mode: 'insensitive' as const } },
              {
                translations: {
                  some: {
                    locale: { in: [locale, this.locales.defaultLocale] },
                    OR: [
                      { normalizedName: { contains: normalizedSearch } },
                      { normalizedDescription: { contains: normalizedSearch } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [totalItems, rows] = await Promise.all([
      this.prisma.service.count({ where }),
      this.prisma.service.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: {
          translations: {
            where: { locale: { in: [locale, this.locales.defaultLocale] } },
          },
        },
      }),
    ]);

    return {
      items: rows.map((service) => this.serialize(service, locale)),
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    };
  }

  async get(serviceId: number, locale: string) {
    return this.cache.getOrLoad(
      CacheNamespace.Services,
      { operation: 'detail', serviceId, locale },
      this.config.get<number>('cache.servicesTtlSeconds', 300),
      () => this.loadOne(serviceId, locale),
    );
  }

  private async loadOne(serviceId: number, locale: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, isActive: true },
      include: {
        translations: {
          where: { locale: { in: [locale, this.locales.defaultLocale] } },
        },
        options: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            translations: {
              where: { locale: { in: [locale, this.locales.defaultLocale] } },
            },
          },
        },
      },
    });
    if (!service) throw new NotFoundException('Active service not found');
    return {
      ...this.serialize(service, locale),
      options: service.options.map((option) => this.serializeOption(option, locale)),
    };
  }

  async create(actor: User, dto: CreateServiceDto): Promise<ServiceResponse> {
    const translations = this.normalizeTranslations(dto.translations);
    const service = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`latache-service:${dto.slug.toLowerCase()}`}))
      `;
      const existing = await transaction.service.findFirst({
        where: { slug: { equals: dto.slug, mode: 'insensitive' } },
      });
      if (existing) throw new ConflictException('Service slug already exists');
      const now = new Date();
      const created = await transaction.service.create({
        data: {
          name: dto.name,
          description: dto.description,
          slug: dto.slug,
          icon: dto.icon,
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? 0,
          createdAt: now,
          updatedAt: now,
        },
      });
      await this.upsertServiceTranslations(transaction, created.id, translations, {
        name: created.name ?? dto.name,
        description: created.description,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'service_category_created',
          entityType: 'service',
          entityId: created.id,
          metadata: { slug: created.slug, name: created.name },
        },
        transaction,
      );
      return transaction.service.findUniqueOrThrow({
        where: { id: created.id },
        include: { translations: { orderBy: { locale: 'asc' } } },
      });
    });
    await this.invalidateServiceCaches();
    return this.serializeAdmin(service);
  }

  async update(actor: User, serviceId: number, dto: UpdateServiceDto): Promise<ServiceResponse> {
    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('Service not found');
    const translations = this.normalizeTranslations(dto.translations);
    const english = translations.find(
      (translation) => translation.locale === this.locales.defaultLocale,
    );

    const updated = await this.prisma.$transaction(async (transaction) => {
      if (dto.slug && dto.slug.toLowerCase() !== service.slug?.toLowerCase()) {
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`latache-service:${dto.slug.toLowerCase()}`}))
        `;
        const duplicate = await transaction.service.findFirst({
          where: {
            id: { not: serviceId },
            slug: { equals: dto.slug, mode: 'insensitive' },
          },
        });
        if (duplicate) throw new ConflictException('Service slug already exists');
      }

      const row = await transaction.service.update({
        where: { id: serviceId },
        data: {
          ...(dto.name !== undefined || english?.name !== undefined
            ? { name: dto.name ?? english?.name }
            : {}),
          ...(dto.description !== undefined || english?.description !== undefined
            ? { description: dto.description ?? english?.description }
            : {}),
          ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
          ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      });
      await this.upsertServiceTranslations(transaction, serviceId, translations, {
        name: row.name ?? service.name ?? '',
        description: row.description,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'service_category_updated',
          entityType: 'service',
          entityId: serviceId,
          metadata: { fields: Object.keys(dto) },
        },
        transaction,
      );
      return transaction.service.findUniqueOrThrow({
        where: { id: serviceId },
        include: { translations: { orderBy: { locale: 'asc' } } },
      });
    });
    await this.invalidateServiceCaches();
    return this.serializeAdmin(updated);
  }

  async delete(actor: User, serviceId: number): Promise<{ deleted: true; id: string }> {
    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('Service not found');
    const bookings = await this.prisma.booking.count({ where: { serviceId } });
    if (bookings > 0) {
      throw new ConflictException({
        code: 'SERVICE_PURGE_BLOCKED',
        message: 'This service is referenced by booking history and cannot be permanently deleted.',
        bookingCount: bookings,
      });
    }
    const assets = this.storage.extractManagedAssets(service.icon);
    await this.prisma.$transaction(async (transaction) => {
      await this.storage.enqueue(transaction, assets, 'service', serviceId, actor.id);
      await transaction.service.delete({ where: { id: serviceId } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'service_category_permanently_deleted',
          entityType: 'service',
          entityId: serviceId,
          metadata: { slug: service.slug, irreversible: true, assetCount: assets.length },
        },
        transaction,
      );
    });
    await this.storage.attemptImmediate('service', serviceId, assets.length);
    await this.invalidateServiceCaches();
    return { deleted: true, id: String(serviceId) };
  }

  async listOptions(serviceId: number, locale: string) {
    return this.cache.getOrLoad(
      CacheNamespace.Services,
      { operation: 'options', serviceId, locale },
      this.config.get<number>('cache.servicesTtlSeconds', 300),
      () => this.loadOptions(serviceId, locale),
    );
  }

  private async loadOptions(serviceId: number, locale: string) {
    const exists = await this.prisma.service.count({ where: { id: serviceId, isActive: true } });
    if (!exists) throw new NotFoundException('Active service not found');
    const rows = await this.prisma.serviceOption.findMany({
      where: { serviceId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        translations: {
          where: { locale: { in: [locale, this.locales.defaultLocale] } },
        },
      },
    });
    return rows.map((row) => this.serializeOption(row, locale));
  }

  async createOption(actor: User, serviceId: number, dto: CreateServiceOptionDto) {
    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('Service not found');
    const translations = this.normalizeTranslations(dto.translations);
    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const row = await transaction.serviceOption.create({
          data: {
            serviceId,
            name: dto.name,
            slug: dto.slug,
            description: dto.description ?? null,
            sortOrder: dto.sortOrder ?? 0,
          },
        });
        await this.upsertOptionTranslations(transaction, row.id, translations, {
          name: row.name,
          description: row.description,
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'service_option_created',
            entityType: 'service_option',
            entityId: row.id,
            metadata: { serviceId, slug: row.slug },
          },
          transaction,
        );
        const result = await transaction.serviceOption.findUniqueOrThrow({
          where: { id: row.id },
          include: { translations: { orderBy: { locale: 'asc' } } },
        });
        return this.serializeOptionAdmin(result);
      });
      await this.invalidateServiceCaches();
      return result;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'P2002') {
        throw new ConflictException('Service option slug already exists for this service');
      }
      throw error;
    }
  }

  async updateOption(
    actor: User,
    serviceId: number,
    optionId: number,
    dto: UpdateServiceOptionDto,
  ) {
    const option = await this.prisma.serviceOption.findFirst({
      where: { id: optionId, serviceId },
    });
    if (!option) throw new NotFoundException('Service option not found');
    const translations = this.normalizeTranslations(dto.translations);
    const english = translations.find(
      (translation) => translation.locale === this.locales.defaultLocale,
    );
    const result = await this.prisma.$transaction(async (transaction) => {
      const row = await transaction.serviceOption.update({
        where: { id: optionId },
        data: {
          ...(dto.name !== undefined || english?.name !== undefined
            ? { name: dto.name ?? english?.name }
            : {}),
          ...(dto.description !== undefined || english?.description !== undefined
            ? { description: dto.description ?? english?.description }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      });
      await this.upsertOptionTranslations(transaction, optionId, translations, {
        name: row.name,
        description: row.description,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'service_option_updated',
          entityType: 'service_option',
          entityId: optionId,
          metadata: { serviceId, fields: Object.keys(dto) },
        },
        transaction,
      );
      const result = await transaction.serviceOption.findUniqueOrThrow({
        where: { id: optionId },
        include: { translations: { orderBy: { locale: 'asc' } } },
      });
      return this.serializeOptionAdmin(result);
    });
    await this.invalidateServiceCaches();
    return result;
  }

  async deleteOption(
    actor: User,
    serviceId: number,
    optionId: number,
  ): Promise<{ deleted: true; id: string }> {
    const option = await this.prisma.serviceOption.findFirst({
      where: { id: optionId, serviceId },
    });
    if (!option) throw new NotFoundException('Service option not found');
    const bookings = await this.prisma.booking.count({ where: { serviceOptionId: optionId } });
    if (bookings > 0) {
      throw new ConflictException({
        code: 'SERVICE_OPTION_PURGE_BLOCKED',
        message:
          'This service option is referenced by booking history and cannot be permanently deleted.',
        bookingCount: bookings,
      });
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.serviceOption.delete({ where: { id: optionId } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'service_option_permanently_deleted',
          entityType: 'service_option',
          entityId: optionId,
          metadata: { serviceId, slug: option.slug, irreversible: true },
        },
        transaction,
      );
    });
    await this.invalidateServiceCaches();
    return { deleted: true, id: String(optionId) };
  }

  private async invalidateServiceCaches(): Promise<void> {
    await Promise.all([
      this.cache.invalidate(CacheNamespace.Services),
      this.cache.invalidate(CacheNamespace.AdminAnalytics),
    ]);
  }

  private serializeOption(
    option: {
      id: number;
      serviceId: number;
      name: string;
      slug: string;
      description: string | null;
      isActive: boolean;
      sortOrder: number;
      translations?: TranslationRow[];
    },
    locale: string,
  ) {
    const selected = this.locales.selectTranslation(option.translations ?? [], locale);
    return {
      id: String(option.id),
      serviceId: String(option.serviceId),
      name: selected.translation?.name ?? option.name,
      slug: option.slug,
      description: selected.translation?.description ?? option.description,
      isActive: option.isActive,
      sortOrder: option.sortOrder,
      resolvedLocale: selected.translation ? selected.resolvedLocale : 'canonical',
      translationFallback: selected.translation ? selected.fallback : true,
    };
  }

  private serialize(
    service: Service & { translations?: TranslationRow[] },
    locale: string,
  ): ServiceResponse {
    const selected = this.locales.selectTranslation(service.translations ?? [], locale);
    return {
      id: service.id.toString(),
      name: selected.translation?.name ?? service.name,
      description: selected.translation?.description ?? service.description,
      icon: service.icon ?? '',
      slug: service.slug,
      isActive: service.isActive,
      sortOrder: service.sortOrder,
      resolvedLocale: selected.translation ? selected.resolvedLocale : 'canonical',
      translationFallback: selected.translation ? selected.fallback : true,
    };
  }

  private serializeAdmin(service: Service & { translations: TranslationRow[] }): ServiceResponse {
    return {
      id: service.id.toString(),
      name: service.name,
      description: service.description,
      icon: service.icon ?? '',
      slug: service.slug,
      isActive: service.isActive,
      sortOrder: service.sortOrder,
      translations: service.translations.map((translation) => ({ ...translation })),
    };
  }

  private serializeOptionAdmin(option: {
    id: number;
    serviceId: number;
    name: string;
    slug: string;
    description: string | null;
    isActive: boolean;
    sortOrder: number;
    translations: TranslationRow[];
  }) {
    return {
      id: String(option.id),
      serviceId: String(option.serviceId),
      name: option.name,
      slug: option.slug,
      description: option.description,
      isActive: option.isActive,
      sortOrder: option.sortOrder,
      translations: option.translations.map((translation) => ({ ...translation })),
    };
  }

  private normalizeTranslations(translations: TranslationDto[] | undefined): TranslationRow[] {
    const normalized = (translations ?? []).map((translation) => ({
      locale: this.locales.requireSupported(translation.locale),
      name: translation.name.trim(),
      description: translation.description?.trim() ?? null,
    }));
    const locales = normalized.map((translation) => translation.locale);
    if (new Set(locales).size !== locales.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_TRANSLATION_LOCALE',
        message: 'Each locale may appear only once in translations',
      });
    }
    return normalized;
  }

  private async upsertServiceTranslations(
    transaction: Prisma.TransactionClient,
    serviceId: number,
    translations: TranslationRow[],
    canonical: { name: string; description: string | null },
  ): Promise<void> {
    const byLocale = new Map(translations.map((translation) => [translation.locale, translation]));
    byLocale.set(this.locales.defaultLocale, {
      locale: this.locales.defaultLocale,
      name: canonical.name,
      description: canonical.description,
    });
    for (const translation of byLocale.values()) {
      const data = {
        name: translation.name,
        description: translation.description,
        normalizedName: this.locales.normalizeSearchText(translation.name),
        normalizedDescription: translation.description
          ? this.locales.normalizeSearchText(translation.description)
          : null,
      };
      await transaction.serviceTranslation.upsert({
        where: { serviceId_locale: { serviceId, locale: translation.locale } },
        create: { serviceId, locale: translation.locale, ...data },
        update: data,
      });
    }
  }

  private async upsertOptionTranslations(
    transaction: Prisma.TransactionClient,
    serviceOptionId: number,
    translations: TranslationRow[],
    canonical: { name: string; description: string | null },
  ): Promise<void> {
    const byLocale = new Map(translations.map((translation) => [translation.locale, translation]));
    byLocale.set(this.locales.defaultLocale, {
      locale: this.locales.defaultLocale,
      name: canonical.name,
      description: canonical.description,
    });
    for (const translation of byLocale.values()) {
      const data = {
        name: translation.name,
        description: translation.description,
        normalizedName: this.locales.normalizeSearchText(translation.name),
        normalizedDescription: translation.description
          ? this.locales.normalizeSearchText(translation.description)
          : null,
      };
      await transaction.serviceOptionTranslation.upsert({
        where: {
          serviceOptionId_locale: { serviceOptionId, locale: translation.locale },
        },
        create: { serviceOptionId, locale: translation.locale, ...data },
        update: data,
      });
    }
  }
}
