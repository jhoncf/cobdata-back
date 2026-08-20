import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PaymentProviderType, PaymentMethod } from '../enums';
import { PaymentProviderAdapter } from './payment-provider-adapter.interface';

export const PAYMENT_ADAPTERS_TOKEN = 'PAYMENT_ADAPTERS';

/**
 * PaymentProviderFactory — single entry point for selecting a payment provider adapter.
 *
 * Controllers and services MUST use this factory to obtain an adapter;
 * direct adapter selection via conditionals is not allowed.
 */
@Injectable()
export class PaymentProviderFactory {
  private readonly adaptersMap: Map<PaymentProviderType, PaymentProviderAdapter>;

  constructor(
    @Inject(PAYMENT_ADAPTERS_TOKEN)
    adapters: PaymentProviderAdapter[],
  ) {
    this.adaptersMap = new Map(
      adapters.map((adapter) => [adapter.providerType, adapter]),
    );
  }

  /**
   * Returns the registered adapter for the given provider type.
   * @throws NotFoundException if no adapter is registered for that type.
   */
  get(providerType: PaymentProviderType): PaymentProviderAdapter {
    const adapter = this.adaptersMap.get(providerType);
    if (!adapter) {
      throw new NotFoundException(
        `No payment adapter registered for provider type "${providerType}"`,
      );
    }
    return adapter;
  }

  /**
   * Checks if the adapter for the given provider type supports the given payment method.
   * Returns false if the adapter is not found or does not support the method.
   */
  supportsMethod(
    providerType: PaymentProviderType,
    method: PaymentMethod,
  ): boolean {
    const adapter = this.adaptersMap.get(providerType);
    if (!adapter) {
      return false;
    }
    return adapter
      .getCapabilities()
      .some(
        (capability) =>
          capability.method === method && capability.supported,
      );
  }

  /**
   * Gets the adapter for the given provider type and validates that it supports the given payment method.
   * This is the method the service layer should call to ensure method validation at the factory level.
   *
   * @throws NotFoundException if no adapter is registered for that provider type.
   * @throws UnprocessableEntityException if the adapter does not support the given payment method.
   */
  getAndValidateMethod(
    providerType: PaymentProviderType,
    method: PaymentMethod,
  ): PaymentProviderAdapter {
    const adapter = this.get(providerType);
    const supported = adapter
      .getCapabilities()
      .some(
        (capability) =>
          capability.method === method && capability.supported,
      );
    if (!supported) {
      throw new UnprocessableEntityException(
        `Payment method "${method}" is not supported by provider "${providerType}"`,
      );
    }
    return adapter;
  }
}
