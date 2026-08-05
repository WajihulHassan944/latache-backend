import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TaskersController } from './taskers.controller';
import { TaskersRepository } from './taskers.repository';
import { TaskersService } from './taskers.service';

@Module({
  imports: [AuthModule],
  controllers: [TaskersController],
  providers: [TaskersService, TaskersRepository],
  exports: [TaskersService, TaskersRepository],
})
export class TaskersModule {}
