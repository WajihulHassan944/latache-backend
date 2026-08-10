import { Module } from '@nestjs/common';
import { RbacRepository } from './repositories/rbac.repository';
import { RbacAccessService } from './services/rbac-access.service';

@Module({
  providers: [RbacRepository, RbacAccessService],
  exports: [RbacRepository, RbacAccessService],
})
export class RbacCoreModule {}
