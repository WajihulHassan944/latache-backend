import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../generated/prisma/client';
import type { User } from '../../../generated/prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { LocaleService } from '../../localization/locale.service';
import { AppCacheService, CacheNamespace } from '../../../infrastructure/redis/app-cache.service';
import { normalizePagination } from '../../../common/utils/pagination.util';
import { SeoPageListQueryDto, SeoRedirectDto, SeoResolveQueryDto, SeoSitemapEntryDto, SeoSettingsDto, UpsertSeoPageDto } from '../dto/seo.dto';

const json = (value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined => value === undefined ? undefined : value as Prisma.InputJsonValue;
const normalizePath = (value: string | undefined): string => {
  const trimmed = (value ?? '/').trim();
  if (!trimmed.startsWith('/')) throw new BadRequestException('SEO paths must start with /');
  const path = trimmed.split(/[?#]/, 1)[0] ?? '/';
  return path.length > 1 ? path.replace(/\/+$/, '') : '/';
};
const normalizeLocale = (locale: string): string => locale.trim().toLowerCase();
const normalizeRedirectTarget = (value: string): string => /^https?:\/\//i.test(value.trim()) ? value.trim() : normalizePath(value);

@Injectable()
export class SeoManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly locales: LocaleService,
    private readonly cache: AppCacheService,
    private readonly config: ConfigService,
  ) {}

  async publicMeta(query: SeoResolveQueryDto) {
    const locale = this.locales.requireSupported(query.locale ?? this.locales.defaultLocale);
    const path = normalizePath(query.path);
    return this.cache.getOrLoad(CacheNamespace.PlatformContent, { operation: 'seo-meta', path, locale }, 300, () => this.resolve(path, locale));
  }

  async resolve(path: string, locale: string) {
    const [settings, redirect, exact, english, content] = await Promise.all([
      this.settingsRow(),
      this.prisma.seoRedirect.findFirst({ where: { fromPath: path, isActive: true } }),
      this.prisma.seoPage.findFirst({ where: { path, locale, isActive: true } }),
      locale === this.locales.defaultLocale ? Promise.resolve(null) : this.prisma.seoPage.findFirst({ where: { path, locale: this.locales.defaultLocale, isActive: true } }),
      this.prisma.contentPage.findFirst({ where: { slug: path === '/' ? 'home' : path.slice(1), isPublished: true, status: 'published' }, include: { translations: true } }),
    ]);
    if (redirect) return { kind: 'redirect', path, redirect: { toPath: redirect.toPath, statusCode: redirect.statusCode, preserveQuery: redirect.preserveQuery } };

    const configured = exact ?? english;
    const translation = content?.translations.find((item) => item.locale === locale) ?? content?.translations.find((item) => item.locale === this.locales.defaultLocale);
    const canonicalBase = this.publicBaseUrl(settings);
    const canonical = configured?.canonicalUrl ?? `${canonicalBase}${path === '/' ? '/' : path}`;

    let dynamicTitle: string | undefined;
    let dynamicDescription: string | undefined;
    let dynamicStructured: Record<string, unknown> | undefined;
    const servicePrefix = settings.servicePathTemplate.split('{slug}')[0];
    const taskerPrefix = settings.taskerPathTemplate.split('{id}')[0];
    if (!configured && settings.includeServices && servicePrefix && path.startsWith(servicePrefix)) {
      const slug = decodeURIComponent(path.slice(servicePrefix.length)).replace(/^\/+|\/+$/g, '');
      if (slug) {
        const service = await this.prisma.service.findFirst({ where: { slug, isActive: true }, include: { translations: true } });
        const tr = service?.translations.find((x) => x.locale === locale) ?? service?.translations.find((x) => x.locale === this.locales.defaultLocale);
        if (service) {
          dynamicTitle = tr?.name ?? service.name ?? undefined;
          dynamicDescription = tr?.description ?? service.description ?? undefined;
          dynamicStructured = { '@context': 'https://schema.org', '@type': 'Service', name: dynamicTitle, description: dynamicDescription, url: canonical, provider: { '@type': 'Organization', name: settings.siteName ?? 'Latache', url: canonicalBase } };
        }
      }
    }
    if (!configured && settings.includePublicTaskers && taskerPrefix && path.startsWith(taskerPrefix)) {
      const rawId = decodeURIComponent(path.slice(taskerPrefix.length)).replace(/^\/+|\/+$/g, '');
      const id = Number(rawId);
      if (Number.isInteger(id) && id > 0) {
        const tasker = await this.prisma.user.findFirst({ where: { id, roles: { has: 'tasker' }, deletedAt: null, accountStatus: 'active', isVerified: true, onboardingStatus: 'approved', isProfilePublic: true, taskerProfile: { is: { status: 'active' } } }, select: { firstName: true, lastName: true, aboutMe: true, profilePicture: true, serviceAreaCity: true } });
        if (tasker) {
          dynamicTitle = (`${tasker.firstName ?? ''} ${tasker.lastName ?? ''}`.trim() || settings.defaultTitle || settings.siteName || 'Latache');
          dynamicDescription = tasker.aboutMe?.slice(0, 1000) || `Public Latache Tasker profile${tasker.serviceAreaCity ? ` in ${tasker.serviceAreaCity}` : ''}.`;
          dynamicStructured = { '@context': 'https://schema.org', '@type': 'Person', name: dynamicTitle, description: dynamicDescription, url: canonical, image: tasker.profilePicture || undefined };
        }
      }
    }
    const title = configured?.title ?? dynamicTitle ?? translation?.seoTitle ?? content?.seoTitle ?? translation?.title ?? content?.title ?? settings.defaultTitle ?? settings.siteName ?? 'Latache';
    const description = configured?.description ?? dynamicDescription ?? translation?.seoDescription ?? content?.seoDescription ?? translation?.description ?? content?.description ?? settings.defaultDescription ?? '';
    const structured = configured?.structuredData && Object.keys(configured.structuredData as object).length
      ? configured.structuredData
      : dynamicStructured ?? (content ? { '@context': 'https://schema.org', '@type': 'WebPage', name: title, description, url: canonical } : settings.defaultStructuredData);
    const alternates = configured?.alternates ?? {};
    const managed = Boolean(configured || content || dynamicTitle);
    return {
      kind: managed ? 'meta' : 'unmanaged', path, locale, resolvedLocale: configured?.locale ?? translation?.locale ?? this.locales.defaultLocale,
      title, description, canonical,
      robots: { index: managed && (configured?.robotsIndex ?? settings.defaultRobotsIndex), follow: managed && (configured?.robotsFollow ?? settings.defaultRobotsFollow) },
      openGraph: { title: configured?.ogTitle ?? title, description: configured?.ogDescription ?? description, url: canonical, image: configured?.ogImageUrl ?? settings.defaultOgImageUrl, imageAlt: configured?.ogImageAlt ?? settings.defaultOgImageAlt, type: 'website' },
      twitter: { card: configured?.twitterCard ?? settings.twitterCard, title: configured?.twitterTitle ?? title, description: configured?.twitterDescription ?? description, image: configured?.twitterImageUrl ?? configured?.ogImageUrl ?? settings.defaultOgImageUrl, handle: settings.twitterHandle },
      keywords: configured?.keywords ?? [], structuredData: structured ?? {}, organization: settings.organizationSchema ?? {}, alternates,
      source: configured ? 'seo_page' : content ? 'content_page' : 'global_defaults',
    };
  }

  async robots(): Promise<string> {
    const settings = await this.settingsRow();
    const lines = ['User-agent: *'];
    const rules = Array.isArray(settings.robotsRules) ? settings.robotsRules.filter((v): v is string => typeof v === 'string') : [];
    lines.push(...rules);
    if (!rules.some((line) => line.toLowerCase().startsWith('allow:'))) lines.push('Allow: /');
    if (settings.sitemapEnabled) lines.push(`Sitemap: ${this.publicBaseUrl(settings)}/api/seo/sitemap.xml`);
    return `${lines.join('\n')}\n`;
  }

  async sitemap(): Promise<string> {
    const settings = await this.settingsRow();
    if (!settings.sitemapEnabled) return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
    const urls = new Map<string, { lastmod?: string; priority?: string; changefreq?: string }>();
    const add = (path: string, data: { lastmod?: Date | null; priority?: unknown; changefreq?: string | null } = {}) => {
      const normalized = normalizePath(path);
      if (urls.has(normalized)) return;
      urls.set(normalized, { lastmod: data.lastmod?.toISOString(), priority: data.priority == null ? undefined : String(data.priority), changefreq: data.changefreq ?? undefined });
    };
    const [pages, entries, services, taskers] = await Promise.all([
      this.prisma.contentPage.findMany({ where: { isPublished: true, status: 'published' }, select: { slug: true, updatedAt: true } }),
      this.prisma.seoSitemapEntry.findMany({ where: { isActive: true }, orderBy: { path: 'asc' } }),
      settings.includeServices ? this.prisma.service.findMany({ where: { isActive: true, slug: { not: null } }, select: { slug: true, updatedAt: true } }) : Promise.resolve([]),
      settings.includePublicTaskers ? this.prisma.user.findMany({ where: { isProfilePublic: true, isVerified: true, deletedAt: null, accountStatus: 'active', roles: { has: 'tasker' } }, select: { id: true, updatedAt: true } }) : Promise.resolve([]),
    ]);
    for (const page of pages) add(page.slug === 'home' ? '/' : `/${page.slug}`, { lastmod: page.updatedAt, priority: page.slug === 'home' ? 1 : 0.7, changefreq: 'weekly' });
    for (const entry of entries) add(entry.path, { lastmod: entry.lastModifiedAt, priority: entry.priority, changefreq: entry.changeFrequency });
    for (const service of services) if (service.slug) add(settings.servicePathTemplate.replace('{slug}', encodeURIComponent(service.slug)), { lastmod: service.updatedAt, priority: 0.8, changefreq: 'weekly' });
    for (const tasker of taskers) add(settings.taskerPathTemplate.replace('{id}', String(tasker.id)), { lastmod: tasker.updatedAt, priority: 0.6, changefreq: 'weekly' });
    const base = this.publicBaseUrl(settings);
    const xml = [...urls.entries()].map(([path, data]) => `<url><loc>${this.xmlEscape(`${base}${path === '/' ? '/' : path}`)}</loc>${data.lastmod ? `<lastmod>${data.lastmod}</lastmod>` : ''}${data.changefreq ? `<changefreq>${this.xmlEscape(data.changefreq)}</changefreq>` : ''}${data.priority ? `<priority>${this.xmlEscape(data.priority)}</priority>` : ''}</url>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${xml}</urlset>`;
  }

  async adminSettings() { return this.serializeSettings(await this.settingsRow()); }
  async updateSettings(actor: User, dto: SeoSettingsDto) {
    const current = await this.settingsRow();
    const updated = await this.prisma.seoSettings.upsert({ where: { id: 'global' }, create: { id: 'global', ...this.settingsData(dto), updatedById: actor.id }, update: { ...this.settingsData(dto), updatedById: actor.id } });
    await this.audit.record({ actorId: actor.id, action: 'seo_settings_updated', entityType: 'seo_settings', entityId: 'global', metadata: { previousUpdatedAt: current.updatedAt.toISOString() } });
    await this.invalidate();
    return this.serializeSettings(updated);
  }

  async listPages(query: SeoPageListQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const search = query.search?.trim();
    const where: Prisma.SeoPageWhereInput = { ...(query.locale ? { locale: normalizeLocale(query.locale) } : {}), ...(search ? { OR: [{ path: { contains: search, mode: 'insensitive' } }, { title: { contains: search, mode: 'insensitive' } }] } : {}) };
    const [totalItems, items] = await Promise.all([this.prisma.seoPage.count({ where }), this.prisma.seoPage.findMany({ where, orderBy: [{ path: 'asc' }, { locale: 'asc' }], skip: offset, take: limit })]);
    return { items, page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) };
  }
  async getPage(id: string) { const row = await this.prisma.seoPage.findUnique({ where: { id } }); if (!row) throw new NotFoundException('SEO page not found'); return row; }
  async upsertPage(actor: User, dto: UpsertSeoPageDto) {
    const path = normalizePath(dto.path); const locale = normalizeLocale(dto.locale); this.locales.requireSupported(locale);
    const data = { ...dto, path, locale, structuredData: json(dto.structuredData) ?? {}, alternates: json(dto.alternates) ?? {}, updatedById: actor.id, priority: dto.priority };
    try {
      const row = await this.prisma.seoPage.upsert({ where: { path_locale: { path, locale } }, create: { ...data, isActive: dto.isActive ?? true }, update: { ...data, ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }) } });
      await this.audit.record({ actorId: actor.id, action: 'seo_page_upserted', entityType: 'seo_page', entityId: row.id, metadata: { path, locale } }); await this.invalidate(); return row;
    } catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('SEO page already exists for this path and locale'); throw e; }
  }
  async deletePage(actor: User, id: string) { const row = await this.getPage(id); await this.prisma.seoPage.delete({ where: { id } }); await this.audit.record({ actorId: actor.id, action: 'seo_page_deleted', entityType: 'seo_page', entityId: id, metadata: { path: row.path, locale: row.locale } }); await this.invalidate(); return { deleted: true, id }; }

  async listRedirects() { return this.prisma.seoRedirect.findMany({ orderBy: { fromPath: 'asc' } }); }
  async upsertRedirect(actor: User, dto: SeoRedirectDto) {
    const fromPath = normalizePath(dto.fromPath);
    const toPath = normalizeRedirectTarget(dto.toPath);
    if (toPath === fromPath) throw new BadRequestException('SEO redirect cannot target itself');
    if (!/^https?:\/\//i.test(toPath)) {
      const seen = new Set([fromPath]);
      let next = toPath;
      for (let depth = 0; depth < 20; depth += 1) {
        if (seen.has(next)) throw new BadRequestException('SEO redirect would create a redirect loop');
        seen.add(next);
        const nextRedirect = await this.prisma.seoRedirect.findFirst({ where: { fromPath: next, isActive: true } });
        if (!nextRedirect || /^https?:\/\//i.test(nextRedirect.toPath)) break;
        next = normalizePath(nextRedirect.toPath);
      }
    }
    const row = await this.prisma.seoRedirect.upsert({ where: { fromPath }, create: { ...dto, fromPath, toPath, updatedById: actor.id }, update: { ...dto, fromPath, toPath, updatedById: actor.id } });
    await this.audit.record({ actorId: actor.id, action: 'seo_redirect_upserted', entityType: 'seo_redirect', entityId: row.id, metadata: { fromPath, toPath, statusCode: dto.statusCode } });
    await this.invalidate();
    return row;
  }
  async deleteRedirect(actor: User, id: string) { const row = await this.prisma.seoRedirect.findUnique({ where: { id } }); if (!row) throw new NotFoundException('SEO redirect not found'); await this.prisma.seoRedirect.delete({ where: { id } }); await this.audit.record({ actorId: actor.id, action: 'seo_redirect_deleted', entityType: 'seo_redirect', entityId: id, metadata: { fromPath: row.fromPath } }); await this.invalidate(); return { deleted: true, id }; }

  async listSitemapEntries() { return this.prisma.seoSitemapEntry.findMany({ orderBy: { path: 'asc' } }); }
  async upsertSitemapEntry(actor: User, dto: SeoSitemapEntryDto) { let lastModifiedAt: Date | undefined; if (dto.lastModifiedAt) { lastModifiedAt = new Date(dto.lastModifiedAt); if (Number.isNaN(lastModifiedAt.getTime())) throw new BadRequestException('lastModifiedAt must be a valid ISO date'); } const path = normalizePath(dto.path); const row = await this.prisma.seoSitemapEntry.upsert({ where: { path }, create: { ...dto, path, lastModifiedAt, updatedById: actor.id, priority: dto.priority }, update: { ...dto, path, lastModifiedAt, updatedById: actor.id, priority: dto.priority } }); await this.audit.record({ actorId: actor.id, action: 'seo_sitemap_entry_upserted', entityType: 'seo_sitemap_entry', entityId: row.id, metadata: { path } }); await this.invalidate(); return row; }
  async deleteSitemapEntry(actor: User, id: string) { const row = await this.prisma.seoSitemapEntry.findUnique({ where: { id } }); if (!row) throw new NotFoundException('SEO sitemap entry not found'); await this.prisma.seoSitemapEntry.delete({ where: { id } }); await this.audit.record({ actorId: actor.id, action: 'seo_sitemap_entry_deleted', entityType: 'seo_sitemap_entry', entityId: id, metadata: { path: row.path } }); await this.invalidate(); return { deleted: true, id }; }

  private async settingsRow() { return this.prisma.seoSettings.upsert({ where: { id: 'global' }, create: { id: 'global', defaultCanonicalBaseUrl: this.config.get<string>('seo.publicBaseUrl') ?? this.config.get<string>('app.baseUrl', 'http://localhost:8080') }, update: {} }); }
  private settingsData(dto: SeoSettingsDto): Prisma.SeoSettingsUncheckedCreateInput {
    return {
      siteName: dto.siteName,
      defaultTitle: dto.defaultTitle,
      defaultDescription: dto.defaultDescription,
      defaultCanonicalBaseUrl: dto.defaultCanonicalBaseUrl,
      defaultOgImageUrl: dto.defaultOgImageUrl,
      defaultOgImageAlt: dto.defaultOgImageAlt,
      twitterCard: dto.twitterCard,
      twitterHandle: dto.twitterHandle,
      defaultRobotsIndex: dto.defaultRobotsIndex,
      defaultRobotsFollow: dto.defaultRobotsFollow,
      organizationSchema: json(dto.organizationSchema) ?? {},
      defaultStructuredData: json(dto.defaultStructuredData) ?? {},
      robotsRules: dto.robotsRules ? (dto.robotsRules as Prisma.InputJsonValue) : undefined,
      sitemapEnabled: dto.sitemapEnabled,
      includeServices: dto.includeServices,
      includePublicTaskers: dto.includePublicTaskers,
      servicePathTemplate: dto.servicePathTemplate,
      taskerPathTemplate: dto.taskerPathTemplate,
    };
  }
  private serializeSettings(row: Awaited<ReturnType<SeoManagementService['settingsRow']>>) { return { ...row, organizationSchema: row.organizationSchema, defaultStructuredData: row.defaultStructuredData, robotsRules: row.robotsRules }; }
  private publicBaseUrl(settings: { defaultCanonicalBaseUrl: string | null }) { return (settings.defaultCanonicalBaseUrl ?? this.config.get<string>('seo.publicBaseUrl') ?? this.config.get<string>('app.baseUrl', 'http://localhost:8080')).replace(/\/$/, ''); }
  private xmlEscape(value: string) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
  private async invalidate() { await this.cache.invalidate(CacheNamespace.PlatformContent); }
}
