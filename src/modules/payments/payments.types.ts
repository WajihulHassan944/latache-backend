export interface SavedPaymentMethodView {
  id: string;
  type: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
}

export interface SetupIntentView {
  id: string;
  clientSecret: string;
  customerId: string;
}

export interface WalletView {
  availableBalance: { amount: number; currency: string };
  refunds: { amount: number; currency: string };
  totalSpent: { amount: number; currency: string };
}

export interface PaymentTransactionView {
  id: string;
  kind: string;
  provider: string;
  providerReference: string | null;
  bookingId: string | null;
  status: string;
  amount: { amount: number; currency: string };
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentTransactionListView {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  items: PaymentTransactionView[];
}

export interface BookingPaymentStatusView {
  bookingId: string;
  source: string;
  status: string;
  currency: string;
  paymentMethodId: string | null;
  paymentIntentId: string | null;
  serviceAmount: number | null;
  platformFeeAmount: number;
  commissionRatePercent: number;
  taxAmount: number;
  taxRatePercent: number;
  taxInclusive: boolean;
  serviceSurchargeAmount: number;
  tipAmount: number;
  donationAmount: number;
  totalChargedAmount: number | null;
  failureReason: string | null;
  paidAt: string | null;
}

export interface WalletTopupIntentView {
  transactionId: string;
  paymentIntentId: string;
  clientSecret: string;
  amount: { amount: number; currency: string };
  status: string;
}

export interface PaymentOrchestrationResult {
  bookingId: number;
  status: string;
  paymentIntentId?: string;
  clientSecret?: string | null;
}

export interface BookingRefundRequest {
  bookingId: number;
  complaintId: string;
  resolutionId: string;
  actorId: number;
  amount: number;
  summary: string;
}

export interface BookingRefundResult {
  bookingId: number;
  resolutionId: string;
  transactionId: string;
  provider: string;
  providerReference: string | null;
  status: string;
  amount: { amount: number; currency: string };
}
