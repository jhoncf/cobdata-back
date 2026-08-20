import { PaymentSettlementEvent } from './payment-settlement-event.interface';

/**
 * Serasa Settlement Mapper (stub).
 *
 * Maps Serasa-specific webhook events (PaidAgreementEvent, PaidInstallmentEvent)
 * into the canonical PaymentSettlementEvent contract.
 *
 * The actual Serasa adapter integration will be completed when the Serasa provider
 * is migrated to use the unified settlement pipeline.
 */

/**
 * Maps a Serasa PaidAgreementEvent into the canonical PaymentSettlementEvent.
 *
 * Serasa PaidAgreementEvent typically contains:
 * - transactionId: string
 * - debtId: string
 * - agreementId: string
 * - paidAt: string (ISO date)
 * - amount?: string (may not be present, resolved from agreement snapshot)
 * - commissionPercentage?: number
 * - commissionValue?: number
 */
export function mapPaidAgreement(serasaEvent: any): PaymentSettlementEvent {
  return {
    provider: 'SERASA_LNOP',
    eventType: 'PAID_AGREEMENT',
    externalEventId: serasaEvent.transactionId ?? serasaEvent.eventId ?? '',
    externalTransactionId: serasaEvent.transactionId ?? undefined,
    contractReference: serasaEvent.debtId ?? serasaEvent.contractReference ?? '',
    agreementReference: serasaEvent.agreementId ?? serasaEvent.agreementReference ?? undefined,
    installmentNumber: undefined,
    amount: serasaEvent.amount?.toString() ?? '0',
    paidAt: serasaEvent.paidAt ? new Date(serasaEvent.paidAt) : new Date(),
    status: 'CONFIRMED',
    providerPayload: sanitizeSerasaPayload(serasaEvent),
  };
}

/**
 * Maps a Serasa PaidInstallmentEvent into the canonical PaymentSettlementEvent.
 *
 * Serasa PaidInstallmentEvent typically contains:
 * - transactionId: string
 * - debtId: string
 * - agreementId: string
 * - installmentNumber: number
 * - paidAt: string (ISO date)
 * - amount?: string (may not be present — resolved from agreement snapshot via amountSource)
 * - commissionPercentage?: number
 * - commissionValue?: number
 *
 * Note: The PaidInstallmentEvent from Serasa may not include the installment amount.
 * In that case, the amount is resolved from the ClosedAgreementEvent snapshot with
 * amountSource = 'AGREEMENT_SNAPSHOT' (handled upstream by the settlement processor).
 */
export function mapPaidInstallment(serasaEvent: any): PaymentSettlementEvent {
  return {
    provider: 'SERASA_LNOP',
    eventType: 'PAID_INSTALLMENT',
    externalEventId: serasaEvent.transactionId ?? serasaEvent.eventId ?? '',
    externalTransactionId: serasaEvent.transactionId ?? undefined,
    contractReference: serasaEvent.debtId ?? serasaEvent.contractReference ?? '',
    agreementReference: serasaEvent.agreementId ?? serasaEvent.agreementReference ?? undefined,
    installmentNumber: serasaEvent.installmentNumber ?? serasaEvent.parcelNumber ?? undefined,
    amount: serasaEvent.amount?.toString() ?? '0',
    paidAt: serasaEvent.paidAt ? new Date(serasaEvent.paidAt) : new Date(),
    status: 'CONFIRMED',
    providerPayload: sanitizeSerasaPayload(serasaEvent),
  };
}

/**
 * Sanitizes Serasa payload for storage.
 * Preserves commission fields and non-sensitive metadata.
 * Removes any PII or secrets that shouldn't be stored.
 */
function sanitizeSerasaPayload(
  serasaEvent: any,
): Record<string, unknown> | undefined {
  if (!serasaEvent) return undefined;

  const payload: Record<string, unknown> = {};

  // Preserve commission data (non-PII, business-relevant)
  if (serasaEvent.commissionPercentage !== undefined) {
    payload.commissionPercentage = serasaEvent.commissionPercentage;
  }
  if (serasaEvent.commissionValue !== undefined) {
    payload.commissionValue = serasaEvent.commissionValue;
  }

  // Preserve event metadata
  if (serasaEvent.eventType) {
    payload.originalEventType = serasaEvent.eventType;
  }
  if (serasaEvent.status !== undefined) {
    payload.originalStatus = serasaEvent.status;
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}
