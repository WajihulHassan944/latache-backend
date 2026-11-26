export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
/** Accounts whose normal balance is a debit. */
export const DEBIT_NORMAL = new Set<AccountType>(['asset', 'expense']);

export const ACC = {
  Bank: '1010',
  CashOnHand: '1015',
  Stripe: '1020',
  Cmi: '1030',
  CommissionReceivable: '1100',
  VatRecoverable: '1150',
  CustomerWallets: '2010',
  TaskerAvailable: '2020',
  TaskerClearing: '2030',
  CustomerWithdrawals: '2045',
  TaskerDeposits: '2050',
  BookingFunds: '2060',
  SettlementClearing: '2070',
  VatPayable: '2100',
  Donations: '2150',
  AccountsPayable: '2200',
  OwnerCapital: '3000',
  RetainedEarnings: '3100',
  OpeningEquity: '3900',
  ServiceFees: '4010',
  CancellationFees: '4020',
  PlanRevenue: '4030',
  Surcharges: '4040',
  RefundsBorne: '4090',
  OtherIncome: '4900',
  ProcessingFees: '5010',
  ReferralRewards: '5020',
  PlanIncentives: '5030',
  Chargebacks: '5040',
  Salaries: '6010',
  Rent: '6020',
  Hosting: '6030',
  Marketing: '6040',
  Professional: '6050',
  BankCharges: '6060',
  Office: '6070',
  Taxes: '6080',
  OtherExpense: '6900',
  Unmatched: '6990',
} as const;

export interface SystemAccount {
  code: string;
  name: string;
  type: AccountType;
  isControl?: boolean;
  isCash?: boolean;
  /** Seeded but removable/editable like a custom account. */
  optional?: boolean;
  description?: string;
}

export const SYSTEM_CHART: SystemAccount[] = [
  { code: ACC.Bank, name: 'Bank account', type: 'asset', isCash: true },
  { code: ACC.CashOnHand, name: 'Cash on hand', type: 'asset', isCash: true },
  { code: ACC.Stripe, name: 'Stripe balance (card money in transit)', type: 'asset', isCash: true },
  { code: ACC.Cmi, name: 'CMI balance (card money in transit)', type: 'asset', isCash: true },
  { code: ACC.CommissionReceivable, name: 'Cash commission owed by Taskers', type: 'asset', isControl: true },
  { code: ACC.VatRecoverable, name: 'VAT recoverable (on purchases)', type: 'asset' },
  { code: ACC.CustomerWallets, name: 'Customer wallet balances', type: 'liability', isControl: true },
  { code: ACC.TaskerAvailable, name: 'Tasker balances - available', type: 'liability', isControl: true },
  { code: ACC.TaskerClearing, name: 'Tasker balances - clearing and payouts in process', type: 'liability', isControl: true },
  { code: ACC.CustomerWithdrawals, name: 'Customer withdrawals in process', type: 'liability', isControl: true },
  { code: ACC.TaskerDeposits, name: 'Tasker deposits held (refundable)', type: 'liability', isControl: true },
  { code: ACC.BookingFunds, name: 'Booking funds held until settlement', type: 'liability', isControl: true },
  { code: ACC.SettlementClearing, name: 'Tasker settlement clearing', type: 'liability', isControl: true },
  { code: ACC.VatPayable, name: 'VAT payable (on sales)', type: 'liability' },
  { code: ACC.Donations, name: 'Donations payable', type: 'liability' },
  { code: ACC.AccountsPayable, name: 'Accounts payable (unpaid expenses)', type: 'liability', isControl: true },
  { code: ACC.OwnerCapital, name: "Owner's capital", type: 'equity' },
  { code: ACC.RetainedEarnings, name: 'Retained earnings', type: 'equity' },
  { code: ACC.OpeningEquity, name: 'Opening balance equity', type: 'equity' },
  { code: ACC.ServiceFees, name: 'Platform service fees', type: 'revenue' },
  { code: ACC.CancellationFees, name: 'Late cancellation fees', type: 'revenue' },
  { code: ACC.PlanRevenue, name: 'Tasker plan subscriptions', type: 'revenue' },
  { code: ACC.Surcharges, name: 'Service surcharges', type: 'revenue' },
  { code: ACC.RefundsBorne, name: 'Refunds and discounts borne by the platform', type: 'revenue', description: 'Reduces revenue.' },
  { code: ACC.OtherIncome, name: 'Other income', type: 'revenue' },
  { code: ACC.ProcessingFees, name: 'Payment processing fees', type: 'expense' },
  { code: ACC.ReferralRewards, name: 'Referral rewards', type: 'expense' },
  { code: ACC.PlanIncentives, name: 'Tasker plan bonuses and revenue share', type: 'expense' },
  { code: ACC.Chargebacks, name: 'Chargeback losses', type: 'expense' },
  { code: ACC.Salaries, name: 'Salaries and wages', type: 'expense', optional: true },
  { code: ACC.Rent, name: 'Rent and utilities', type: 'expense', optional: true },
  { code: ACC.Hosting, name: 'Hosting and software', type: 'expense', optional: true },
  { code: ACC.Marketing, name: 'Marketing and advertising', type: 'expense', optional: true },
  { code: ACC.Professional, name: 'Accounting and legal fees', type: 'expense', optional: true },
  { code: ACC.BankCharges, name: 'Bank charges', type: 'expense', optional: true },
  { code: ACC.Office, name: 'Office and supplies', type: 'expense', optional: true },
  { code: ACC.Taxes, name: 'Business taxes and duties', type: 'expense', optional: true },
  { code: ACC.OtherExpense, name: 'Other expenses', type: 'expense', optional: true },
  { code: ACC.Unmatched, name: 'Unmatched settlement differences', type: 'expense', description: 'Automatic postings with no matching payment record. Should stay at zero.' },
];

export const ACCOUNTING_SETTING_KEY = 'accounting';
