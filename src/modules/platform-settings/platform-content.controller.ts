import { Controller, Get } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequestLocale } from '../localization/request-locale.decorator';
import { PlatformSettingsService } from './platform-settings.service';

@ApiTags('03 Platform')
@Controller('platform/content')
export class PlatformContentController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiHeader({
    name: 'Accept-Language',
    required: false,
    example: 'ary',
    description: 'Supports en, ar, and ary (Moroccan Darija), with English fallback.',
  })
  @ApiOperation({
    summary: 'Get localized public platform content and current currency',
    description:
      'Reads the same general Platform Settings resource managed by administrators and returns the current public platform currency context. It never exposes internal financial policy settings.',
  })
  get(@RequestLocale() locale: string): Promise<Record<string, unknown>> {
    return this.settings.publicContent(locale);
  }
}
