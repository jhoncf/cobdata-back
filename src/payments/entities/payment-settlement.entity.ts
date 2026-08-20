import { PaymentSettlementSource, PaymentSettlementStatus } from '../enums';

/**
 * PaymentSettlement entity.
 * Immutable ledger record of a confirmed payment linked to a Contract.
 * Settlements are never deleted or mutated; reversals create a new record with status REVERSED.
 */
export interface PaymentSettlementEntity {
  id: string;
  accountId: string;
  contractId: string;
  /** FK to PaymentCharge — nullable until PaymentCharge model exists */
  paymentChargeId: string | null;
  /** Reference to the agreement that originated this payment (e.g. Serasa agreement) */
  agreementReference: string | null;
  /** Installment number when payment is partial/installment-based */
  installmentNumber: number | null;
  /** Origin channel/provider that confirmed the payment */
  source: PaymentSettlementSource;
  /** Settlement status — CONFIRMED or REVERSED */
  status: PaymentSettlementStatus;
  /** Paid amount in BRL */
  amount: string; // Decimal serialized as string for precision
  /** Effective payment date/time as reported by the provider */
  paidAt: Date;
  /** External identifier from the payment provider (e.g. e2eId for Pix) */
  externalPaymentId: string;
  /** Channel event/transaction identifier (e.g. webhook event ID) */
  channelEventId: string | null;
  /** Debt/contract reference from the provider payload */
  debtReference: string | null;
  /** Additional metadata (non-sensitive, no PII) */
  metadata: Record<string, unknown> | null;
  /** Raw provider payload preserved for traceability (no secrets) */
  providerPayload: Record<string, unknown> | null;
  createdAt: Date;
}
