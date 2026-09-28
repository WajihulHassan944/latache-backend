import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { PaymentsController } from './payments.controller';

const rolesOf = (handler: keyof PaymentsController) =>
  Reflect.getMetadata(ROLES_KEY, PaymentsController.prototype[handler]) as UserRole[] | undefined;

describe('PaymentsController role boundaries', () => {
  it.each(['createSetupIntent', 'methods', 'defaultMethod'] as const)(
    '%s is open to Customers and Taskers (Tasker plan "Card on File")',
    (handler) => {
      expect(rolesOf(handler)).toEqual([UserRole.Customer, UserRole.Tasker]);
    },
  );

  it.each(['deleteMethod', 'wallet', 'topup', 'transactions', 'bookingPayment', 'retry'] as const)(
    '%s stays customer-only via the controller-level guard',
    (handler) => {
      expect(rolesOf(handler)).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, PaymentsController)).toEqual([UserRole.Customer]);
    },
  );
});
