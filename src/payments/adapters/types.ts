import {
  PaymentMethod,
  PaymentChargeStatus,
  PaymentGatewayEnvironment,
} from '../enums';

/**
 * Describes a payment capability supported by a provider adapter.
 */
export interface PaymentCapability {
  method: PaymentMethod;
  supported: boolean;
  features?: string[]; // e.g., ['qrCode', 'copyPaste']
}

/**
 * Describes a missing field detected during pre-validation.
 */
export interface MissingField {
  field: string;
  reason: string; // e.g., 'required', 'invalid_format'
}

/**
 * Input data required to issue a payment charge.
 * Contains contract, debtor and payment details.
 */
export interface IssuePaymentChargeInput {
  contractId: string;
  method: PaymentMethod;
  amount: string; // Decimal as string for precision
  dueDate: Date;
  idempotencyKey: string;
  txid?: string; // pre-generated for Pix
  expiresAt?: Date; // for Pix expiration
  debtor: {
    name: string;
    document: string; // CPF or CNPJ
    email?: string;
    phone?: string;
    address?: {
      street: string;
      number: string;
      complement?: string;
      neighborhood: string;
      city: string;
      state: string;
      zipCode: string;
    };
  };
}

/**
 * Decrypted gateway configuration passed to the adapter.
 * Contains all secrets needed to authenticate with the provider.
 */
export interface DecryptedGatewayConfig {
  clientId: string;
  clientSecret: string;
  developerKey: string;
  certificateBase64?: string;
  certificatePassword?: string;
  pixKey?: string;
  environment: PaymentGatewayEnvironment;
  timeoutMs: number;
  maxRetries: number;
}

/**
 * Result of a successful charge issuance from the provider.
 * All fields are optional since different methods return different artifacts.
 */
export interface IssuedPaymentCharge {
  externalId?: string;
  externalStatus?: string;
  ourNumber?: string;
  txid?: string;
  digitableLine?: string;
  barcode?: string;
  pixCopyPaste?: string;
  qrCodeUrl?: string;
  documentUrl?: string;
  issuedAt?: Date;
  expiresAt?: Date;
  providerPayload?: Record<string, unknown>;
}

/**
 * Status update returned by fetchStatus or cancel operations.
 */
export interface PaymentChargeUpdate {
  status: PaymentChargeStatus;
  externalStatus?: string;
  paidAt?: Date;
  failureCode?: string;
  failureMessage?: string;
  providerPayload?: Record<string, unknown>;
}
