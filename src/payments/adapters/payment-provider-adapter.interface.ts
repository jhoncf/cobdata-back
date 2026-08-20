import { PaymentProviderType } from '../enums';
import { PaymentChargeEntity } from '../entities/payment-charge.entity';
import {
  PaymentCapability,
  MissingField,
  IssuePaymentChargeInput,
  DecryptedGatewayConfig,
  IssuedPaymentCharge,
  PaymentChargeUpdate,
} from './types';

/**
 * PaymentProviderAdapter — port for payment provider integrations.
 *
 * Each provider (e.g. Banco do Brasil) implements this interface.
 * The PaymentProviderFactory selects the correct adapter by providerType.
 *
 * Design contract:
 * - The adapter knows only the provider protocol.
 * - RBAC, idempotency, persistence and auditing are handled by the service layer.
 * - Optional methods (fetchStatus, cancel) are implemented only when the provider supports them.
 */
export interface PaymentProviderAdapter {
  readonly providerType: PaymentProviderType;

  /**
   * Returns the payment capabilities supported by this adapter.
   */
  getCapabilities(): PaymentCapability[];

  /**
   * Pre-validates the input data before calling the external provider.
   * Returns an empty array when all required fields are present.
   */
  validateIssueInput(input: IssuePaymentChargeInput): MissingField[];

  /**
   * Issues a payment charge with the external provider.
   */
  issue(
    input: IssuePaymentChargeInput,
    config: DecryptedGatewayConfig,
  ): Promise<IssuedPaymentCharge>;

  /**
   * Queries the current status of a charge from the provider.
   * Optional — only implemented when the provider supports status queries.
   */
  fetchStatus?(
    charge: PaymentChargeEntity,
    config: DecryptedGatewayConfig,
  ): Promise<PaymentChargeUpdate>;

  /**
   * Requests cancellation of a charge from the provider.
   * Optional — only implemented when the provider supports cancellation.
   */
  cancel?(
    charge: PaymentChargeEntity,
    config: DecryptedGatewayConfig,
  ): Promise<PaymentChargeUpdate>;
}
