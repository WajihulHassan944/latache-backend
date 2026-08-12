import { Controller, Get } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestLocale } from '../localization/request-locale.decorator';
import { PlatformSettingsService } from './platform-settings.service';

@ApiTags('01 Platform')
@Controller('platform/content')
export class PlatformContentController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get()
  @ApiHeader({
    name: 'Accept-Language',
    required: false,
    example: 'ary',
    description: 'Supports en, ar, and ary (Moroccan Darija), with English fallback.',
  })
  @ApiOperation({
    summary: 'Get localized public platform informational content',
    description:
      'Reads the same general Platform Settings resource managed by administrators. It never exposes internal capability or policy settings.',
  })
  get(@RequestLocale() locale: string): Promise<Record<string, unknown>> {
    return this.settings.publicContent(locale);
  }
}
