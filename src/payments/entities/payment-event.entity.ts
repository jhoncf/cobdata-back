import { PaymentChargeStatus, PaymentEventSource } from '../enums';

/**
 * PaymentEvent entity.
 * Records lifecycle transitions of a PaymentCharge for audit and traceability.
 * Each event captures the source of the transition and optional metadata.
 */
export interface PaymentEventEntity {
  id: string;
  /** Reference to the PaymentCharge this event belongs to */
  paymentChargeId: string;
  /** Status before the transition (null for initial creation) */
  fromStatus: PaymentChargeStatus | null;
  /** Status after the transition */
  toStatus: PaymentChargeStatus;
  /** Origin of the event (webhook, sync, job, or manual action) */
  source: PaymentEventSource;
  /** Additional context about the event (provider payload, user info, etc.) */
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}
