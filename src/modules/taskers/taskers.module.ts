import { Module } from '@nestjs/common';
import { ReviewsModule } from '../reviews/reviews.module';
import { AuthModule } from '../auth/auth.module';
import { GuestModule } from '../guest/guest.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { UploadsModule } from '../uploads/uploads.module';
import { TaskersController } from './taskers.controller';
import { TaskersRepository } from './taskers.repository';
import { TaskersService } from './taskers.service';

@Module({
  imports: [AuthModule, GuestModule, ReviewsModule, PlatformSettingsModule, UploadsModule],
  controllers: [TaskersController],
  providers: [TaskersService, TaskersRepository],
  exports: [TaskersService, TaskersRepository],
})
export class TaskersModule {}
