import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { RbacController } from './controllers/rbac.controller';
import { RbacCoreModule } from './rbac-core.module';
import { RbacService } from './services/rbac.service';

@Module({
  imports: [AuthModule, RbacCoreModule, AdminAuditModule],
  controllers: [RbacController],
  providers: [RbacService],
  exports: [RbacCoreModule],
})
export class RbacModule {}
