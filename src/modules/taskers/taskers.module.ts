import { Module } from '@nestjs/common';
import { ReviewsModule } from '../reviews/reviews.module';
import { AuthModule } from '../auth/auth.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { TaskersController } from './taskers.controller';
import { TaskersRepository } from './taskers.repository';
import { TaskersService } from './taskers.service';

@Module({
  imports: [AuthModule, ReviewsModule, PlatformSettingsModule],
  controllers: [TaskersController],
  providers: [TaskersService, TaskersRepository],
  exports: [TaskersService, TaskersRepository],
})
export class TaskersModule {}
