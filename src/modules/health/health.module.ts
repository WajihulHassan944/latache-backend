import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { RealtimeModule } from '../realtime/realtime.module';
import { AccountDeletionModule } from '../account-deletion/account-deletion.module';

@Module({ imports: [RealtimeModule, AccountDeletionModule], controllers: [HealthController] })
export class HealthModule {}
