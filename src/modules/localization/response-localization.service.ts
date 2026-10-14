import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { LocaleService } from './locale.service';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

@Injectable()
export class ResponseLocalizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locales: LocaleService,
  ) {}

  /**
   * Explicit call-site resolution for a single booking's service name, using the
   * same exact-locale -> English -> first-available -> canonical fallback as
   * `selectTranslation`/GET /services. Prefer `resolveServiceNames` when resolving
   * more than one id at once to avoid N+1 queries.
   */
  async resolveServiceName(serviceId: number, locale: string): Promise<string> {
    const map = await this.resolveServiceNames([serviceId], locale);
    return map.get(serviceId) ?? '';
  }

  async resolveServiceNames(serviceIds: number[], locale: string): Promise<Map<number, string>> {
    const ids = [...new Set(serviceIds)].filter((id) => Number.isInteger(id) && id > 0);
    const map = new Map<number, string>();
    if (!ids.length) return map;
    const rows = await this.prisma.service.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        translations: {
          where: { locale: { in: [locale, this.locales.defaultLocale] } },
          select: { locale: true, name: true, description: true },
        },
      },
    });
    for (const row of rows) {
      const selected = this.locales.selectTranslation(row.translations, locale);
      map.set(row.id, selected.translation?.name ?? row.name ?? '');
    }
    return map;
  }

  async localize(payload: unknown, locale: string, path: string): Promise<unknown> {
    // Only the Service-management admin surface (/api/admin/services) deliberately
    // reads/writes canonical fields; every other admin route (analytics, bookings,
    // disputes, reviews, finance, ...) should resolve the same as any other caller.
    if (locale === this.locales.defaultLocale || path.startsWith('/api/admin/services'))
      return payload;

    const services: JsonRecord[] = [];
    const options: JsonRecord[] = [];
    this.collect(payload, undefined, services, options, new WeakSet<object>());
    const serviceIds = this.ids(services);
    const optionIds = this.ids(options);
    if (serviceIds.length === 0 && optionIds.length === 0) return payload;

    const [serviceRows, optionRows] = await Promise.all([
      serviceIds.length
        ? this.prisma.service.findMany({
            where: { id: { in: serviceIds } },
            select: {
              id: true,
              translations: {
                where: { locale: { in: [locale, this.locales.defaultLocale] } },
                select: { locale: true, name: true, description: true },
              },
            },
          })
        : [],
      optionIds.length
        ? this.prisma.serviceOption.findMany({
            where: { id: { in: optionIds } },
            select: {
              id: true,
              translations: {
                where: { locale: { in: [locale, this.locales.defaultLocale] } },
                select: { locale: true, name: true, description: true },
              },
            },
          })
        : [],
    ]);

    const serviceMap = new Map(serviceRows.map((row) => [row.id, row.translations]));
    const optionMap = new Map(optionRows.map((row) => [row.id, row.translations]));
    for (const target of services) this.apply(target, serviceMap, locale);
    for (const target of options) this.apply(target, optionMap, locale);
    return payload;
  }

  private collect(
    value: unknown,
    parentKey: string | undefined,
    services: JsonRecord[],
    options: JsonRecord[],
    seen: WeakSet<object>,
  ): void {
    if (Array.isArray(value)) {
      if (seen.has(value)) return;
      seen.add(value);
      for (const item of value) {
        if (isRecord(item) && parentKey === 'services') services.push(item);
        if (isRecord(item) && parentKey === 'serviceOptions') options.push(item);
        this.collect(item, parentKey, services, options, seen);
      }
      return;
    }
    if (!isRecord(value) || seen.has(value)) return;
    seen.add(value);
    if (parentKey === 'service') services.push(value);
    if (parentKey === 'serviceOption') options.push(value);
    for (const [key, child] of Object.entries(value)) {
      this.collect(child, key, services, options, seen);
    }
  }

  private ids(rows: JsonRecord[]): number[] {
    const ids = rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
    return [...new Set(ids)];
  }

  private apply(
    target: JsonRecord,
    translationsById: Map<
      number,
      Array<{ locale: string; name: string; description: string | null }>
    >,
    locale: string,
  ): void {
    const id = Number(target.id);
    if (!Number.isInteger(id)) return;
    const selected = this.locales.selectTranslation(translationsById.get(id) ?? [], locale);
    if (!selected.translation) return;
    target.name = selected.translation.name;
    if ('description' in target) target.description = selected.translation.description;
    target.resolvedLocale = selected.resolvedLocale;
    target.translationFallback = selected.fallback;
  }
}
