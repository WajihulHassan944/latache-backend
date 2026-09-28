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
  hasSavedCard: boolean;
  defaultCardId: string | null;
  savedCards: SavedPaymentMethodView[];
  attachCardEndpoint: '/api/payments/setup-intent';
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

/** Stored on Booking.paymentEstimate and returned as payment.estimate. */
export interface PaymentEstimate {
  billableMinutes: number;
  serviceAmount: number;
  platformFeeAmount: number;
  serviceSurchargeAmount: number;
  taxAmount: number;
  taxInclusive: boolean;
  tipAmount: number;
  donationAmount: number;
  /** What the customer pays at acceptance (card/wallet); cash pays the final total on site. */
  total: number;
  calculatedAt: string;
}

export interface BookingPaymentStatusView {
  bookingId: string;
  /** null until the customer chooses how to pay. */
  source: string | null;
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
  referralDiscountAmount: number;
  referralDiscountPercent: number;
  totalChargedAmount: number | null;
  failureReason: string | null;
  paidAt: string | null;
  /** Quote-formula breakdown; estimate.total is what card/wallet pays at acceptance. */
  estimate: PaymentEstimate | null;
  /** What complete-payment charges right now; null when nothing is due (not accepted, paid, or cash). */
  amountDue: number | null;
}

export interface WalletTopupIntentView {
  transactionId: string;
  paymentIntentId: string;
  clientSecret: string;
  amount: { amount: number; currency: string };
  status: string;
}

export interface CustomerWithdrawalView {
  id: string;
  amount: { amount: number; currency: string };
  status: string;
  failureReason: string | null;
  requestedAt: string;
  processedAt: string | null;
  cancelledAt: string | null;
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

export interface ConfirmManualCashDisputeRefundInput {
  complaintId: string;
  resolutionId?: string;
  actorId: number;
  manualTransferReference: string;
  confirmationNotes: string;
}

export interface ManualCashDisputeRefundResult {
  bookingId: number;
  complaintId: string;
  resolutionId: string;
  cashRefundId: string;
  transactionId: string;
  status: string;
  amount: { amount: number; currency: string };
  manualTransferReference: string;
  platformReceivableReversalAmount: number;
  platformCommissionReimbursementAmount: number;
}
