import {
  PaymentMethod,
  PaymentChargeStatus,
  PaymentChargeChannel,
} from '../enums';

/**
 * PaymentCharge entity.
 * Represents a payment charge issued against a Contract via a PaymentGateway.
 * Stores all provider artifacts and lifecycle state.
 */
export interface PaymentChargeEntity {
  id: string;
  accountId: string;
  contractId: string;
  paymentGatewayId: string;
  method: PaymentMethod;
  status: PaymentChargeStatus;
  /** Charge amount in BRL */
  amount: string; // Decimal serialized as string for precision
  dueDate: Date;
  /** Unique idempotency key per gateway — prevents duplicate charges */
  idempotencyKey: string;
  /** External identifier returned by the payment provider */
  externalId: string | null;
  /** External status string from the provider */
  externalStatus: string | null;
  /** "Nosso Número" — boleto identifier at the bank */
  ourNumber: string | null;
  /** Pix transaction ID — system-generated, unique per charge */
  txid: string | null;
  /** Boleto digitable line */
  digitableLine: string | null;
  /** Boleto barcode */
  barcode: string | null;
  /** Pix copia-e-cola string */
  pixCopyPaste: string | null;
  /** QR Code URL or image URL for Pix */
  qrCodeUrl: string | null;
  /** URL to the boleto PDF document */
  documentUrl: string | null;
  /** Raw provider response payload (minimized, no secrets) */
  providerPayload: Record<string, unknown> | null;
  /** Failure code when status is FAILED */
  failureCode: string | null;
  /** Human-readable failure message */
  failureMessage: string | null;
  /** Timestamp when charge was successfully issued */
  issuedAt: Date | null;
  /** Timestamp when charge was confirmed paid */
  paidAt: Date | null;
  /** Expiration timestamp (e.g., Pix 24h expiry) */
  expiresAt: Date | null;
  /** Channel that originated this charge */
  attributedChannel: PaymentChargeChannel | null;
  /** Optimistic locking version */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
