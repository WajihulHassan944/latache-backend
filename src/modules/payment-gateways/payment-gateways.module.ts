import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { TaskerDepositsModule } from '../tasker-deposits/tasker-deposits.module';
import { CmiController } from './cmi/cmi.controller';
import { CmiService } from './cmi/cmi.service';

@Module({
  imports: [AuthModule, NotificationsModule, PaymentsModule, TaskerDepositsModule],
  controllers: [CmiController],
  providers: [CmiService],
})
export class PaymentGatewaysModule {}
