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

  async localize(payload: unknown, locale: string, path: string): Promise<unknown> {
    if (locale === this.locales.defaultLocale || path.startsWith('/api/admin/')) return payload;

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
