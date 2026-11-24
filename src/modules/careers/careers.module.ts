import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { CareersAdminController } from './careers-admin.controller';
import { CareersPublicController } from './careers-public.controller';
import { CareersService } from './careers.service';

@Module({
  imports: [AuthModule, AdminAuditModule, MailModule],
  controllers: [CareersPublicController, CareersAdminController],
  providers: [CareersService],
})
export class CareersModule {}
