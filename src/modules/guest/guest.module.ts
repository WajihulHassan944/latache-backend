import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GuestOnlyGuard } from './guards/guest-only.guard';
import { GuestOrIdentityGuard } from './guards/guest-or-identity.guard';
import { GuestController } from './guest.controller';
import { GuestRepository } from './guest.repository';
import { GuestService } from './guest.service';

@Module({
  imports: [AuthModule],
  controllers: [GuestController],
  providers: [GuestService, GuestRepository, GuestOrIdentityGuard, GuestOnlyGuard],
  exports: [GuestService, GuestOrIdentityGuard],
})
export class GuestModule {}
