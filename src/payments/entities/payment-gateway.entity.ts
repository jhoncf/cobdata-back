import {
  PaymentProviderType,
  PaymentMethod,
  PaymentGatewayEnvironment,
} from '../enums';

/**
 * PaymentGateway entity.
 * Represents a configured payment provider for an Account.
 * Credentials are stored encrypted and must never be exposed in responses.
 */
export interface PaymentGatewayEntity {
  id: string;
  accountId: string;
  name: string;
  providerType: PaymentProviderType;
  environment: PaymentGatewayEnvironment;
  enabled: boolean;
  supportedMethods: PaymentMethod[];
  /** Pix receiver key — encrypted, never exposed in API responses */
  pixKey: string | null;
  /** Encrypted JSON blob containing provider credentials */
  encryptedCredentials: string;
  /** HTTP timeout in milliseconds for provider calls */
  timeoutMs: number;
  /** Maximum retry attempts for transient failures */
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
}
