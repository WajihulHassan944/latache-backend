import type { Prisma } from '../../generated/prisma/client';

export interface CreatePendingEarningInput {
  booking: {
    id: number;
    taskerId: number;
    paymentSource: string;
    paymentCurrency: string;
    serviceAmount: Prisma.Decimal | null;
    platformFeeAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    taxInclusive: boolean;
    serviceSurchargeAmount: Prisma.Decimal;
    tipAmount: Prisma.Decimal;
    donationAmount: Prisma.Decimal;
    totalChargedAmount: Prisma.Decimal | null;
  };
  grossCustomerAmount: number;
  providerSettlementReference: string;
  settledAt: Date;
  transaction: Prisma.TransactionClient;
}

export interface ConfirmCashCollectionInput {
  taskerId: number;
  bookingId: number;
  collectedAmount: number;
  idempotencyKey: string;
}

export interface EarningListQuery {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  from?: Date;
  to?: Date;
}

export interface EarningActionInput {
  actorId: number;
  earningId: string;
  action: 'block' | 'unblock' | 'extend_clearance';
  reason: string;
  holdUntil?: Date;
}
