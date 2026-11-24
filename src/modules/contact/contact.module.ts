import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { ContactAdminController } from './contact-admin.controller';
import { ContactPublicController } from './contact-public.controller';
import { ContactService } from './contact.service';

@Module({
  imports: [AuthModule, AdminAuditModule, MailModule],
  controllers: [ContactPublicController, ContactAdminController],
  providers: [ContactService],
})
export class ContactModule {}
