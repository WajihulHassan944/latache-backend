import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import type { User } from '../../../generated/prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { LocaleService } from '../../localization/locale.service';
import { AppCacheService, CacheNamespace } from '../../../infrastructure/redis/app-cache.service';
import { normalizePagination } from '../../../common/utils/pagination.util';
import type {
  ContentBlockTranslationDto,
  ContentListQueryDto,
  ContentPageTranslationDto,
  CreateContentBlockDto,
  CreateContentPageDto,
  UpdateContentBlockDto,
  UpdateContentPageDto,
} from '../dto/content.dto';

const asJson = (value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined =>
  value === undefined ? undefined : (value as Prisma.InputJsonValue);

type ContentPageAdminRow = Prisma.ContentPageGetPayload<{
  include: {
    translations: true;
    blocks: { include: { translations: true } };
  };
}>;

type ContentPageListRow = Prisma.ContentPageGetPayload<{
  include: { translations: true; _count: { select: { blocks: true } } };
}>;

type ContentBlockWithTranslations = Prisma.ContentBlockGetPayload<{
  include: { translations: true };
}>;

@Injectable()
export class ContentManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly locales: LocaleService,
    private readonly cache: AppCacheService,
  ) {}

  async homepageServices(locale: string): Promise<Record<string, unknown>> {
    const normalizedLocale = this.locales.requireSupported(locale);
    return this.cache.getOrLoad(CacheNamespace.ManagedContent, { operation: 'home-services', locale: normalizedLocale }, 120, async () => {
      const rows = await this.prisma.service.findMany({
        where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 24,
        include: { translations: true, options: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { translations: true } } },
      });
      return { items: rows.map((row) => { const tr = row.translations.find((x) => x.locale === normalizedLocale) ?? row.translations.find((x) => x.locale === this.locales.defaultLocale); return { id: row.id, slug: row.slug, name: tr?.name ?? row.name, description: tr?.description ?? row.description, icon: row.icon, options: row.options.map((option) => { const ot = option.translations.find((x) => x.locale === normalizedLocale) ?? option.translations.find((x) => x.locale === this.locales.defaultLocale); return { id: option.id, slug: option.slug, name: ot?.name ?? option.name, description: ot?.description ?? option.description }; }) }; }) };
    });
  }

  async homepagePopularProjects(locale: string): Promise<Record<string, unknown>> {
    const normalizedLocale = this.locales.requireSupported(locale);
    return this.cache.getOrLoad(CacheNamespace.ManagedContent, { operation: 'home-popular-projects', locale: normalizedLocale }, 120, async () => {
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const grouped = await this.prisma.booking.groupBy({ by: ['serviceId'], where: { status: 'completed', taskCompletedAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { serviceId: 'desc' } }, take: 8 });
      const ids = grouped.map((row) => row.serviceId);
      if (!ids.length) return { items: [] };
      const services = await this.prisma.service.findMany({ where: { id: { in: ids }, isActive: true }, include: { translations: true }, });
      const countMap = new Map(grouped.map((row) => [row.serviceId, row._count._all]));
      return { items: services.sort((a, b) => (countMap.get(b.id) ?? 0) - (countMap.get(a.id) ?? 0)).map((row) => { const tr = row.translations.find((x) => x.locale === normalizedLocale) ?? row.translations.find((x) => x.locale === this.locales.defaultLocale); return { id: row.id, slug: row.slug, name: tr?.name ?? row.name, description: tr?.description ?? row.description, completedBookings90d: countMap.get(row.id) ?? 0 }; }) };
    });
  }

  async homepageRecommendedJobs(locale: string): Promise<Record<string, unknown>> {
    const normalizedLocale = this.locales.requireSupported(locale);
    return this.cache.getOrLoad(CacheNamespace.ManagedContent, { operation: 'home-recommended-jobs', locale: normalizedLocale }, 120, async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const demand = await this.prisma.booking.groupBy({ by: ['serviceId'], where: { createdAt: { gte: since }, status: { notIn: ['cancelled', 'declined', 'rejected'] } }, _count: { _all: true }, orderBy: { _count: { serviceId: 'desc' } }, take: 8 });
      const serviceIds = demand.map((x) => x.serviceId);
      if (!serviceIds.length) return { items: [] };
      const taskers = await this.prisma.user.findMany({ where: { roles: { has: 'tasker' }, deletedAt: null, accountStatus: 'active', isVerified: true, isDocVerified: true, onboardingStatus: 'approved', taskerProfile: { is: { status: 'active' } }, userServices: { some: { serviceId: { in: serviceIds } } } }, select: { id: true, firstName: true, lastName: true, profilePicture: true, rating: true, reviewsCount: true, completedTasks: true, serviceAreaCity: true, userServices: { where: { serviceId: { in: serviceIds } }, select: { serviceId: true, hourlyRate: true } } }, take: 12, orderBy: [{ rating: 'desc' }, { reviewsCount: 'desc' }, { completedTasks: 'desc' }] });
      const demandMap = new Map(demand.map((x) => [x.serviceId, x._count._all]));
      return { items: taskers.map((tasker) => { const best = [...tasker.userServices].sort((a, b) => (demandMap.get(b.serviceId) ?? 0) - (demandMap.get(a.serviceId) ?? 0))[0]; return { id: tasker.id, name: `${tasker.firstName ?? ''} ${tasker.lastName ?? ''}`.trim(), avatar: tasker.profilePicture ?? '', rating: Number(tasker.rating), reviewsCount: tasker.reviewsCount, completedTasks: tasker.completedTasks, serviceAreaCity: tasker.serviceAreaCity, matchedServiceId: best?.serviceId ?? null, hourlyRate: best?.hourlyRate != null ? Number(best.hourlyRate) : null, demandScore: best ? demandMap.get(best.serviceId) ?? 0 : 0 }; }) };
    });
  }

  async homepageManagedBlock(key: 'how_it_works' | 'social_links', locale: string): Promise<Record<string, unknown>> {
    const normalizedLocale = this.locales.requireSupported(locale);
    return this.cache.getOrLoad(CacheNamespace.ManagedContent, { operation: 'home-managed-block', key, locale: normalizedLocale }, 120, async () => {
      const block = await this.prisma.contentBlock.findFirst({ where: { key, isActive: true, page: { slug: 'home', isPublished: true, status: 'published' } }, include: { translations: true } });
      if (!block) return { key, active: false, title: null, subtitle: null, body: null, payload: {} };
      const tr = block.translations.find((x) => x.locale === normalizedLocale) ?? block.translations.find((x) => x.locale === this.locales.defaultLocale);
      return { key, active: true, type: block.type, title: tr?.title ?? null, subtitle: tr?.subtitle ?? null, body: tr?.body ?? null, payload: tr?.payload ?? block.payload ?? {} };
    });
  }

  async homepageTestimonials(locale: string): Promise<Record<string, unknown>> {
    const normalizedLocale = this.locales.requireSupported(locale);
    return this.cache.getOrLoad(CacheNamespace.ManagedContent, { operation: 'home-testimonials', locale: normalizedLocale }, 120, async () => {
      const rows = await this.prisma.review.findMany({ where: { moderationStatus: 'visible', booking: { status: 'completed' }, rating: { gte: 4 }, comment: { not: null } }, orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }], take: 12, include: { reviewer: { select: { id: true, firstName: true, lastName: true, profilePicture: true } }, reviewee: { select: { id: true, firstName: true, lastName: true, profilePicture: true } }, booking: { select: { service: { select: { id: true, name: true, slug: true, translations: true } } } } } });
      return { items: rows.map((row) => { const tr = row.booking.service.translations.find((x) => x.locale === normalizedLocale) ?? row.booking.service.translations.find((x) => x.locale === this.locales.defaultLocale); return { id: row.id, rating: row.rating, comment: row.comment, createdAt: row.createdAt.toISOString(), reviewer: { id: row.reviewer.id, name: `${row.reviewer.firstName ?? ''} ${row.reviewer.lastName ?? ''}`.trim(), avatar: row.reviewer.profilePicture ?? '' }, reviewee: { id: row.reviewee.id, name: `${row.reviewee.firstName ?? ''} ${row.reviewee.lastName ?? ''}`.trim(), avatar: row.reviewee.profilePicture ?? '' }, service: { id: row.booking.service.id, slug: row.booking.service.slug, name: tr?.name ?? row.booking.service.name } }; }) };
    });
  }

  async publicPage(slug: string, locale: string): Promise<Record<string, unknown>> {
    const normalizedLocale = this.locales.requireSupported(locale);
    return this.cache.getOrLoad(
      CacheNamespace.PlatformContent,
      { operation: 'page', slug, locale: normalizedLocale },
      300,
      async () => {
        const page = await this.prisma.contentPage.findFirst({
          where: { slug, isPublished: true, status: 'published' },
          include: {
            translations: true,
            blocks: {
              where: { isActive: true },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              include: { translations: true },
            },
          },
        });
        if (!page) throw new NotFoundException('Published content page not found');
        return this.serializePublic(page, normalizedLocale);
      },
    );
  }

  async adminList(query: ContentListQueryDto): Promise<Record<string, unknown>> {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const status = query.status ?? 'all';
    const conditions: Prisma.ContentPageWhereInput[] = [];
    if (status === 'published') conditions.push({ status: 'published', isPublished: true });
    if (status === 'draft') conditions.push({ OR: [{ status: 'draft' }, { isPublished: false }] });
    const search = query.search?.trim();
    if (search) {
      conditions.push({
        OR: [
          { slug: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
          { translations: { some: { title: { contains: search, mode: 'insensitive' } } } },
        ],
      });
    }
    const where: Prisma.ContentPageWhereInput = conditions.length ? { AND: conditions } : {};
    const [totalItems, rows] = await Promise.all([
      this.prisma.contentPage.count({ where }),
      this.prisma.contentPage.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: [{ updatedAt: 'desc' }, { slug: 'asc' }],
        include: { translations: { orderBy: { locale: 'asc' } }, _count: { select: { blocks: true } } },
      }),
    ]);
    return {
      items: rows.map((row) => this.serializeAdminPage(row)),
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    };
  }

  async adminGet(id: string): Promise<Record<string, unknown>> {
    const row = await this.prisma.contentPage.findUnique({
      where: { id },
      include: {
        translations: { orderBy: { locale: 'asc' } },
        blocks: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: { translations: { orderBy: { locale: 'asc' } } },
        },
      },
    });
    if (!row) throw new NotFoundException('Content page not found');
    return this.serializeAdminPage(row);
  }

  async create(actor: User, dto: CreateContentPageDto): Promise<Record<string, unknown>> {
    this.validateTranslations(dto.translations);
    this.validateBlockKeys(dto.blocks);
    const slug = dto.slug.toLowerCase();
    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const page = await transaction.contentPage.create({
          data: {
            slug,
            pageType: dto.pageType ?? 'standard',
            title: dto.title ?? null,
            description: dto.description ?? null,
            seoTitle: dto.seoTitle ?? null,
            seoDescription: dto.seoDescription ?? null,
            metadata: asJson(dto.metadata) ?? {},
            updatedById: actor.id,
          },
        });
        await this.upsertPageTranslations(transaction, page.id, dto.translations ?? []);
        for (const block of dto.blocks ?? []) {
          await this.createBlockInTransaction(transaction, page.id, block);
        }
        await this.audit.record(
          { actorId: actor.id, action: 'content_page_created', entityType: 'content_page', entityId: page.id, metadata: { slug } },
          transaction,
        );
        return transaction.contentPage.findUniqueOrThrow({
          where: { id: page.id },
          include: { translations: { orderBy: { locale: 'asc' } }, blocks: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { translations: { orderBy: { locale: 'asc' } } } } },
        });
      });
      await this.invalidate();
      return this.serializeAdminPage(created);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('Content page slug already exists');
      throw error;
    }
  }

  async update(actor: User, id: string, dto: UpdateContentPageDto): Promise<Record<string, unknown>> {
    const existing = await this.prisma.contentPage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Content page not found');
    this.validateTranslations(dto.translations);
    try {
      const updated = await this.prisma.$transaction(async (transaction) => {
        const row = await transaction.contentPage.update({
          where: { id },
          data: {
            ...(dto.slug !== undefined ? { slug: dto.slug.toLowerCase() } : {}),
            ...(dto.pageType !== undefined ? { pageType: dto.pageType } : {}),
            ...(dto.title !== undefined ? { title: dto.title } : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
            ...(dto.seoTitle !== undefined ? { seoTitle: dto.seoTitle } : {}),
            ...(dto.seoDescription !== undefined ? { seoDescription: dto.seoDescription } : {}),
            ...(dto.metadata !== undefined ? { metadata: asJson(dto.metadata) } : {}),
            version: { increment: 1 },
            updatedById: actor.id,
          },
        });
        if (dto.translations) await this.upsertPageTranslations(transaction, id, dto.translations);
        await this.audit.record(
          { actorId: actor.id, action: 'content_page_updated', entityType: 'content_page', entityId: id, metadata: { fields: Object.keys(dto) } },
          transaction,
        );
        return transaction.contentPage.findUniqueOrThrow({
          where: { id },
          include: { translations: { orderBy: { locale: 'asc' } }, blocks: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { translations: { orderBy: { locale: 'asc' } } } } },
        });
      });
      await this.invalidate();
      return this.serializeAdminPage(updated);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('Content page slug already exists');
      throw error;
    }
  }

  async deletePage(actor: User, id: string): Promise<{ deleted: true; id: string }> {
    const page = await this.prisma.contentPage.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Content page not found');
    if (page.isPublished || page.status === 'published') {
      throw new ConflictException({
        code: 'PUBLISHED_CONTENT_DELETE_BLOCKED',
        message: 'Unpublish the content page before deleting it permanently.',
      });
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.contentPage.delete({ where: { id } });
      await this.audit.record(
        { actorId: actor.id, action: 'content_page_deleted', entityType: 'content_page', entityId: id, metadata: { slug: page.slug } },
        transaction,
      );
    });
    await this.invalidate();
    return { deleted: true, id };
  }

  async publish(actor: User, id: string): Promise<Record<string, unknown>> {
    const page = await this.prisma.contentPage.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Content page not found');
    const updated = await this.prisma.$transaction(async (transaction) => {
      const row = await transaction.contentPage.update({
        where: { id },
        data: { status: 'published', isPublished: true, publishedAt: new Date(), version: { increment: 1 }, updatedById: actor.id },
        include: { translations: { orderBy: { locale: 'asc' } }, blocks: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { translations: { orderBy: { locale: 'asc' } } } } },
      });
      await this.audit.record({ actorId: actor.id, action: 'content_page_published', entityType: 'content_page', entityId: id }, transaction);
      return row;
    });
    await this.invalidate();
    return this.serializeAdminPage(updated);
  }

  async unpublish(actor: User, id: string): Promise<Record<string, unknown>> {
    const page = await this.prisma.contentPage.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Content page not found');
    const updated = await this.prisma.$transaction(async (transaction) => {
      const row = await transaction.contentPage.update({
        where: { id },
        data: { status: 'draft', isPublished: false, publishedAt: null, version: { increment: 1 }, updatedById: actor.id },
        include: { translations: { orderBy: { locale: 'asc' } }, blocks: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { translations: { orderBy: { locale: 'asc' } } } } },
      });
      await this.audit.record({ actorId: actor.id, action: 'content_page_unpublished', entityType: 'content_page', entityId: id }, transaction);
      return row;
    });
    await this.invalidate();
    return this.serializeAdminPage(updated);
  }

  async createBlock(actor: User, pageId: string, dto: CreateContentBlockDto): Promise<Record<string, unknown>> {
    const page = await this.prisma.contentPage.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Content page not found');
    this.validateTranslations(dto.translations);
    try {
      const row = await this.prisma.$transaction(async (transaction) => {
        const block = await this.createBlockInTransaction(transaction, pageId, dto);
        await transaction.contentPage.update({ where: { id: pageId }, data: { version: { increment: 1 }, updatedById: actor.id } });
        await this.audit.record({ actorId: actor.id, action: 'content_block_created', entityType: 'content_block', entityId: block.id, metadata: { pageId, key: dto.key, type: dto.type } }, transaction);
        return transaction.contentBlock.findUniqueOrThrow({ where: { id: block.id }, include: { translations: { orderBy: { locale: 'asc' } } } });
      });
      await this.invalidate();
      return this.serializeAdminBlock(row);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('Content block key already exists on this page');
      throw error;
    }
  }

  async updateBlock(actor: User, pageId: string, blockId: string, dto: UpdateContentBlockDto): Promise<Record<string, unknown>> {
    const block = await this.prisma.contentBlock.findFirst({ where: { id: blockId, pageId } });
    if (!block) throw new NotFoundException('Content block not found');
    this.validateTranslations(dto.translations);
    const row = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.contentBlock.update({
        where: { id: blockId },
        data: {
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.payload !== undefined ? { payload: asJson(dto.payload) } : {}),
        },
      });
      if (dto.translations) await this.upsertBlockTranslations(transaction, blockId, dto.translations);
      await transaction.contentPage.update({ where: { id: pageId }, data: { version: { increment: 1 }, updatedById: actor.id } });
      await this.audit.record({ actorId: actor.id, action: 'content_block_updated', entityType: 'content_block', entityId: blockId, metadata: { pageId, fields: Object.keys(dto) } }, transaction);
      return transaction.contentBlock.findUniqueOrThrow({ where: { id: blockId }, include: { translations: { orderBy: { locale: 'asc' } } } });
    });
    await this.invalidate();
    return this.serializeAdminBlock(row);
  }

  async deleteBlock(actor: User, pageId: string, blockId: string): Promise<{ deleted: true; id: string }> {
    const block = await this.prisma.contentBlock.findFirst({ where: { id: blockId, pageId } });
    if (!block) throw new NotFoundException('Content block not found');
    await this.prisma.$transaction(async (transaction) => {
      await transaction.contentBlock.delete({ where: { id: blockId } });
      await transaction.contentPage.update({ where: { id: pageId }, data: { version: { increment: 1 }, updatedById: actor.id } });
      await this.audit.record({ actorId: actor.id, action: 'content_block_deleted', entityType: 'content_block', entityId: blockId, metadata: { pageId, key: block.key } }, transaction);
    });
    await this.invalidate();
    return { deleted: true, id: blockId };
  }

  private async createBlockInTransaction(transaction: Prisma.TransactionClient, pageId: string, dto: CreateContentBlockDto) {
    const block = await transaction.contentBlock.create({
      data: {
        pageId,
        key: dto.key,
        type: dto.type,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
        payload: asJson(dto.payload) ?? {},
      },
    });
    await this.upsertBlockTranslations(transaction, block.id, dto.translations ?? []);
    return block;
  }

  private async upsertPageTranslations(transaction: Prisma.TransactionClient, pageId: string, translations: ContentPageTranslationDto[]) {
    for (const translation of translations) {
      const locale = this.locales.requireSupported(translation.locale);
      await transaction.contentPageTranslation.upsert({
        where: { pageId_locale: { pageId, locale } },
        create: { pageId, locale, title: translation.title ?? null, description: translation.description ?? null, seoTitle: translation.seoTitle ?? null, seoDescription: translation.seoDescription ?? null },
        update: { title: translation.title ?? null, description: translation.description ?? null, seoTitle: translation.seoTitle ?? null, seoDescription: translation.seoDescription ?? null },
      });
    }
  }

  private async upsertBlockTranslations(transaction: Prisma.TransactionClient, blockId: string, translations: ContentBlockTranslationDto[]) {
    for (const translation of translations) {
      const locale = this.locales.requireSupported(translation.locale);
      await transaction.contentBlockTranslation.upsert({
        where: { blockId_locale: { blockId, locale } },
        create: { blockId, locale, title: translation.title ?? null, subtitle: translation.subtitle ?? null, body: translation.body ?? null, payload: asJson(translation.payload) ?? {} },
        update: { title: translation.title ?? null, subtitle: translation.subtitle ?? null, body: translation.body ?? null, payload: asJson(translation.payload) ?? {} },
      });
    }
  }

  private validateTranslations(translations: Array<{ locale: string }> | undefined) {
    if (!translations) return;
    const locales = translations.map((item) => this.locales.requireSupported(item.locale));
    if (new Set(locales).size !== locales.length) throw new BadRequestException('Each locale may appear only once');
  }

  private validateBlockKeys(blocks: CreateContentBlockDto[] | undefined) {
    if (!blocks) return;
    const keys = blocks.map((block) => block.key);
    if (new Set(keys).size !== keys.length) throw new BadRequestException('Content block keys must be unique within a page');
  }

  private serializePublic(page: ContentPageAdminRow, locale: string): Record<string, unknown> {
    const pageTranslation = this.pickTranslation(page.translations, locale);
    return {
      slug: page.slug,
      pageType: page.pageType,
      version: page.version,
      title: pageTranslation?.title ?? page.title,
      description: pageTranslation?.description ?? page.description,
      seo: { title: pageTranslation?.seoTitle ?? page.seoTitle, description: pageTranslation?.seoDescription ?? page.seoDescription },
      metadata: page.metadata ?? {},
      resolvedLocale: pageTranslation?.locale ?? 'canonical',
      translationFallback: pageTranslation?.locale !== locale,
      blocks: page.blocks.map((block) => {
        const translation = this.pickTranslation(block.translations, locale);
        return {
          key: block.key,
          type: block.type,
          sortOrder: block.sortOrder,
          payload: block.payload ?? {},
          title: translation?.title ?? null,
          subtitle: translation?.subtitle ?? null,
          body: translation?.body ?? null,
          translationPayload: translation?.payload ?? {},
          resolvedLocale: translation?.locale ?? null,
        };
      }),
    };
  }

  private pickTranslation<T extends { locale: string }>(rows: T[], locale: string): T | undefined {
    return rows.find((row) => row.locale === locale) ?? rows.find((row) => row.locale === this.locales.defaultLocale);
  }

  private serializeAdminPage(row: ContentPageAdminRow | ContentPageListRow): Record<string, unknown> {
    return {
      id: row.id,
      slug: row.slug,
      pageType: row.pageType,
      status: row.status,
      isPublished: row.isPublished,
      version: row.version,
      title: row.title,
      description: row.description,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      metadata: row.metadata ?? {},
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      translations: row.translations,
      blocks: 'blocks' in row ? row.blocks.map((block) => this.serializeAdminBlock(block)) : [],
      blockCount: '_count' in row ? row._count.blocks : ('blocks' in row ? row.blocks.length : 0),
    };
  }

  private serializeAdminBlock(row: ContentBlockWithTranslations): Record<string, unknown> {
    return {
      id: row.id,
      pageId: row.pageId,
      key: row.key,
      type: row.type,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      payload: row.payload ?? {},
      translations: row.translations ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async invalidate(): Promise<void> {
    await Promise.all([
      this.cache.invalidate(CacheNamespace.PlatformContent),
      this.cache.invalidate(CacheNamespace.ManagedContent),
    ]);
  }
}
