import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '../../../generated/prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { SeoBacklinkDto, UpdateSeoBacklinkDto } from '../dto/seo.dto';

export interface SeoScoreInput {
  title?: string | null;
  description?: string | null;
  canonicalUrl?: string | null;
  ogImageUrl?: string | null;
  structuredData?: unknown;
  keywords?: string[] | null;
  robotsIndex?: boolean | null;
}

/** Deterministic completeness checklist for one page's search/social representation (not a crawl). */
export function scoreSeoPage(page: SeoScoreInput): { score: number; checks: { label: string; pass: boolean }[] } {
  const titleLen = page.title?.trim().length ?? 0;
  const descLen = page.description?.trim().length ?? 0;
  const hasStructured =
    page.structuredData !== null &&
    typeof page.structuredData === 'object' &&
    Object.keys(page.structuredData as object).length > 0;
  const checks = [
    { label: 'Title set', pass: titleLen > 0 },
    { label: 'Title length (30–60 chars)', pass: titleLen >= 30 && titleLen <= 60 },
    { label: 'Description set', pass: descLen > 0 },
    { label: 'Description length (120–160 chars)', pass: descLen >= 120 && descLen <= 160 },
    { label: 'Canonical URL set', pass: !!page.canonicalUrl?.trim() },
    { label: 'Social share image set', pass: !!page.ogImageUrl?.trim() },
    { label: 'Structured data (JSON-LD) set', pass: hasStructured },
    { label: 'Keywords set', pass: (page.keywords?.length ?? 0) > 0 },
    { label: 'Indexable', pass: page.robotsIndex !== false },
  ];
  return { score: Math.round((checks.filter((c) => c.pass).length / checks.length) * 100), checks };
}

@Injectable()
export class SeoExtrasService {
  private readonly logger = new Logger(SeoExtrasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly config: ConfigService,
  ) {}

  // ----- redirects (public, uncached so hit counts are real) -----
  async resolveRedirect(path: string) {
    const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
    const row = await this.prisma.seoRedirect.findFirst({ where: { fromPath: normalized, isActive: true } });
    if (!row) return { found: false as const };
    await this.prisma.seoRedirect.update({ where: { id: row.id }, data: { hits: { increment: 1 }, lastHitAt: new Date() } });
    return { found: true as const, toPath: row.toPath, statusCode: row.statusCode, preserveQuery: row.preserveQuery };
  }

  async listPublicRedirects() {
    const rows = await this.prisma.seoRedirect.findMany({ where: { isActive: true }, select: { fromPath: true, toPath: true, statusCode: true, preserveQuery: true }, orderBy: { fromPath: 'asc' }, take: 5000 });
    return { items: rows };
  }

  // ----- 404 tracking -----
  async report404(path: string, referrer?: string) {
    const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
    if (/^\/(api|_next)\b/.test(normalized)) return { ok: true };
    await this.prisma.seoNotFoundHit.upsert({
      where: { path: normalized },
      create: { path: normalized, lastReferrer: referrer ?? null },
      update: { hits: { increment: 1 }, lastSeenAt: new Date(), resolved: false, ...(referrer ? { lastReferrer: referrer } : {}) },
    });
    return { ok: true };
  }

  async list404s(includeResolved = false) {
    const items = await this.prisma.seoNotFoundHit.findMany({
      where: includeResolved ? {} : { resolved: false },
      orderBy: [{ hits: 'desc' }, { lastSeenAt: 'desc' }],
      take: 500,
    });
    return { items };
  }

  async resolve404(actor: User, id: string) {
    const row = await this.prisma.seoNotFoundHit.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('404 record not found');
    await this.prisma.seoNotFoundHit.update({ where: { id }, data: { resolved: true } });
    await this.audit.record({ actorId: actor.id, action: 'seo_404_resolved', entityType: 'seo_not_found', entityId: id, metadata: { path: row.path } });
    return { resolved: true, id };
  }

  // ----- backlinks -----
  async listBacklinks() {
    return { items: await this.prisma.seoBacklink.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 }) };
  }

  async backlinkStats() {
    const [total, live, rows] = await Promise.all([
      this.prisma.seoBacklink.count(),
      this.prisma.seoBacklink.count({ where: { status: 'live' } }),
      this.prisma.seoBacklink.findMany({ select: { sourceUrl: true } }),
    ]);
    const domains = new Set<string>();
    for (const { sourceUrl } of rows) {
      try {
        domains.add(new URL(sourceUrl).hostname.replace(/^www\./, ''));
      } catch {
        domains.add(sourceUrl);
      }
    }
    return { total, live, referringDomains: domains.size };
  }

  async createBacklink(actor: User, dto: SeoBacklinkDto) {
    const row = await this.prisma.seoBacklink.create({ data: { ...dto, updatedById: actor.id } });
    await this.audit.record({ actorId: actor.id, action: 'seo_backlink_created', entityType: 'seo_backlink', entityId: row.id, metadata: { sourceUrl: dto.sourceUrl } });
    return row;
  }

  async updateBacklink(actor: User, id: string, dto: UpdateSeoBacklinkDto) {
    const existing = await this.prisma.seoBacklink.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Backlink not found');
    const row = await this.prisma.seoBacklink.update({
      where: { id },
      data: { ...dto, updatedById: actor.id, ...(dto.status ? { lastCheckedAt: new Date() } : {}) },
    });
    await this.audit.record({ actorId: actor.id, action: 'seo_backlink_updated', entityType: 'seo_backlink', entityId: id, metadata: { sourceUrl: row.sourceUrl, status: row.status } });
    return row;
  }

  async deleteBacklink(actor: User, id: string) {
    const existing = await this.prisma.seoBacklink.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Backlink not found');
    await this.prisma.seoBacklink.delete({ where: { id } });
    await this.audit.record({ actorId: actor.id, action: 'seo_backlink_deleted', entityType: 'seo_backlink', entityId: id, metadata: { sourceUrl: existing.sourceUrl } });
    return { deleted: true, id };
  }

  // ----- page scoring -----
  async scorePages() {
    const pages = await this.prisma.seoPage.findMany({ orderBy: [{ path: 'asc' }, { locale: 'asc' }], take: 1000 });
    return { items: pages.map((p) => ({ id: p.id, path: p.path, locale: p.locale, ...scoreSeoPage(p) })) };
  }

  scoreOne(page: SeoScoreInput) {
    return scoreSeoPage(page);
  }

  // ----- llms.txt -----
  async llmsTxt(): Promise<string> {
    const settings = await this.prisma.seoSettings.findUnique({ where: { id: 'global' } });
    const base = (settings?.defaultCanonicalBaseUrl ?? this.config.get<string>('seo.publicBaseUrl') ?? '').replace(/\/$/, '');
    const name = settings?.siteName ?? 'Latache';
    const [services, pages] = await Promise.all([
      settings?.includeServices === false ? Promise.resolve([]) : this.prisma.service.findMany({ where: { isActive: true, slug: { not: null } }, select: { name: true, slug: true, description: true }, orderBy: { name: 'asc' }, take: 200 }),
      this.prisma.seoPage.findMany({ where: { isActive: true, robotsIndex: true, locale: 'en' }, select: { path: true, title: true, description: true }, orderBy: { path: 'asc' }, take: 200 }),
    ]);
    const servicePath = settings?.servicePathTemplate ?? '/services/{slug}';
    const lines = [`# ${name}`, ''];
    const summary = settings?.llmsSummary?.trim() || settings?.defaultDescription?.trim();
    if (summary) lines.push(`> ${summary.replace(/\s+/g, ' ')}`, '');
    if (pages.length) {
      lines.push('## Pages', '');
      for (const p of pages) lines.push(`- [${p.title ?? p.path}](${base}/en${p.path === '/' ? '' : p.path})${p.description ? `: ${p.description}` : ''}`);
      lines.push('');
    }
    if (services.length) {
      lines.push('## Services', '');
      for (const s of services) if (s.slug) lines.push(`- [${s.name}](${base}/en${servicePath.replace('{slug}', encodeURIComponent(s.slug))})${s.description ? `: ${s.description.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`);
      lines.push('');
    }
    return `${lines.join('\n').trimEnd()}\n`;
  }

  // ----- IndexNow -----
  indexNowKey(): string | undefined {
    return this.config.get<string>('seo.indexNowKey');
  }

  /** Fire-and-forget ping so Bing/Yandex recrawl changed URLs. Never throws. Production only. */
  async pingIndexNow(paths: string[]): Promise<void> {
    try {
      const key = this.indexNowKey();
      const settings = await this.prisma.seoSettings.findUnique({ where: { id: 'global' } });
      if (!key || !paths.length || settings?.indexNowEnabled === false) return;
      if (process.env.NODE_ENV !== 'production') return;
      const base = (settings?.defaultCanonicalBaseUrl ?? this.config.get<string>('seo.publicBaseUrl') ?? '').replace(/\/$/, '');
      if (!base || /localhost|\.vercel\.app/.test(base)) return;
      const host = new URL(base).host;
      void fetch('https://api.indexnow.org/indexnow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key, keyLocation: `${base}/indexnow-key.txt`, urlList: paths.map((p) => `${base}/en${p === '/' ? '' : p}`) }),
        signal: AbortSignal.timeout(8000),
      }).catch((error: unknown) => this.logger.warn(`IndexNow ping failed: ${String(error)}`));
    } catch (error) {
      this.logger.warn(`IndexNow ping skipped: ${String(error)}`);
    }
  }
}
