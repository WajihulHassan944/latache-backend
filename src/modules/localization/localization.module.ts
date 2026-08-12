import { Global, Module } from '@nestjs/common';
import { LocaleService } from './locale.service';
import { ResponseLocalizationService } from './response-localization.service';

@Global()
@Module({
  providers: [LocaleService, ResponseLocalizationService],
  exports: [LocaleService, ResponseLocalizationService],
})
export class LocalizationModule {}
