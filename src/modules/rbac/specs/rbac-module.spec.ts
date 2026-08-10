import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AuthModule } from '../../auth/auth.module';
import { RbacController } from '../controllers/rbac.controller';
import { RbacCoreModule } from '../rbac-core.module';
import { RbacModule } from '../rbac.module';
import { RbacService } from '../services/rbac.service';

describe('RbacModule', () => {
  it('imports auth guards and the cycle-free RBAC core providers', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, RbacModule) as unknown[];
    expect(imports).toEqual(expect.arrayContaining([AuthModule, RbacCoreModule]));
  });

  it('registers the RBAC controller and service', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, RbacModule) as unknown[];
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, RbacModule) as unknown[];
    expect(controllers).toContain(RbacController);
    expect(providers).toContain(RbacService);
  });
});
