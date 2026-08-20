/**
 * Canonical payment settlement event contract.
 * Unifies events from all payment providers (Serasa, Banco do Brasil, etc.)
 * into a single internal structure for settlement processing.
 *
 * Each provider maps its specific event format into this interface.
 */
export interface PaymentSettlementEvent {
  /** Origin provider that confirmed the payment */
  provider: 'SERASA_LNOP' | 'BANCO_DO_BRASIL' | string;
  /** Canonical event type */
  eventType: 'PAID_AGREEMENT' | 'PAID_INSTALLMENT' | 'PIX_PAYMENT' | 'REVERSED';
  /** External event/transaction ID from the provider (used for idempotency) */
  externalEventId: string;
  /** External transaction reference (e.g. e2eId for Pix) */
  externalTransactionId?: string;
  /** Contract reference that links this event to a Contract (e.g. contractNumber or debtId) */
  contractReference: string;
  /** Agreement reference when payment comes from a negotiation/agreement */
  agreementReference?: string;
  /** Installment number for partial/installment-based payments */
  installmentNumber?: number;
  /** Paid amount in BRL as string for precision */
  amount: string;
  /** Effective payment date/time as reported by the provider */
  paidAt: Date;
  /** Settlement status */
  status: 'CONFIRMED' | 'REVERSED';
  /** Raw provider payload preserved for traceability (no secrets, no PII) */
  providerPayload?: Record<string, unknown>;
}
