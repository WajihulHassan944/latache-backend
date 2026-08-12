import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ObservabilityModule } from '../infrastructure/observability/observability.module';

@Global()
@Module({
  imports: [ObservabilityModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
