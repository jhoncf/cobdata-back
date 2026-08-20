import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentProviderFactory, PAYMENT_ADAPTERS_TOKEN } from './payment-provider.factory';
import { PaymentProviderAdapter } from './payment-provider-adapter.interface';
import { PaymentProviderType, PaymentMethod } from '../enums';
import { PaymentCapability } from './types';

/**
 * Stub adapter for testing.
 */
function createStubAdapter(
  providerType: PaymentProviderType,
  capabilities: PaymentCapability[] = [],
): PaymentProviderAdapter {
  return {
    providerType,
    getCapabilities: () => capabilities,
    validateIssueInput: () => [],
    issue: async () => ({}),
  };
}

describe('PaymentProviderFactory', () => {
  let factory: PaymentProviderFactory;
  let bbAdapter: PaymentProviderAdapter;

  beforeEach(async () => {
    bbAdapter = createStubAdapter(PaymentProviderType.BANCO_DO_BRASIL, [
      { method: PaymentMethod.PIX, supported: true, features: ['immediate'] },
      { method: PaymentMethod.BOLETO, supported: true, features: ['standard'] },
      { method: PaymentMethod.BOLEPIX, supported: true, features: ['combined'] },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PAYMENT_ADAPTERS_TOKEN,
          useValue: [bbAdapter],
        },
        PaymentProviderFactory,
      ],
    }).compile();

    factory = module.get<PaymentProviderFactory>(PaymentProviderFactory);
  });

  describe('get()', () => {
    it('should return the adapter for a registered provider type', () => {
      const adapter = factory.get(PaymentProviderType.BANCO_DO_BRASIL);
      expect(adapter).toBe(bbAdapter);
    });

    it('should throw NotFoundException for an unregistered provider type', () => {
      const unknownType = 'UNKNOWN_PROVIDER' as PaymentProviderType;
      expect(() => factory.get(unknownType)).toThrow(NotFoundException);
      expect(() => factory.get(unknownType)).toThrow(
        /No payment adapter registered for provider type "UNKNOWN_PROVIDER"/,
      );
    });
  });

  describe('supportsMethod()', () => {
    it('should return true when the adapter supports the payment method', () => {
      expect(
        factory.supportsMethod(PaymentProviderType.BANCO_DO_BRASIL, PaymentMethod.PIX),
      ).toBe(true);
      expect(
        factory.supportsMethod(PaymentProviderType.BANCO_DO_BRASIL, PaymentMethod.BOLETO),
      ).toBe(true);
      expect(
        factory.supportsMethod(PaymentProviderType.BANCO_DO_BRASIL, PaymentMethod.BOLEPIX),
      ).toBe(true);
    });

    it('should return false when the adapter has the method but supported is false', () => {
      const unsupportedAdapter = createStubAdapter(PaymentProviderType.BANCO_DO_BRASIL, [
        { method: PaymentMethod.PIX, supported: true },
        { method: PaymentMethod.BOLETO, supported: false },
      ]);
      const testFactory = new PaymentProviderFactory([unsupportedAdapter]);

      expect(
        testFactory.supportsMethod(PaymentProviderType.BANCO_DO_BRASIL, PaymentMethod.PIX),
      ).toBe(true);
      expect(
        testFactory.supportsMethod(PaymentProviderType.BANCO_DO_BRASIL, PaymentMethod.BOLETO),
      ).toBe(false);
    });

    it('should return false when the adapter does not support the payment method', () => {
      const pixOnlyAdapter = createStubAdapter(PaymentProviderType.BANCO_DO_BRASIL, [
        { method: PaymentMethod.PIX, supported: true, features: ['immediate'] },
      ]);
      const pixFactory = new PaymentProviderFactory([pixOnlyAdapter]);

      expect(
        pixFactory.supportsMethod(PaymentProviderType.BANCO_DO_BRASIL, PaymentMethod.BOLETO),
      ).toBe(false);
    });

    it('should return false when the provider type is not registered', () => {
      const unknownType = 'UNKNOWN_PROVIDER' as PaymentProviderType;
      expect(factory.supportsMethod(unknownType, PaymentMethod.PIX)).toBe(false);
    });
  });

  describe('getAndValidateMethod()', () => {
    it('should return the adapter when the method is supported', () => {
      const adapter = factory.getAndValidateMethod(
        PaymentProviderType.BANCO_DO_BRASIL,
        PaymentMethod.PIX,
      );
      expect(adapter).toBe(bbAdapter);
    });

    it('should return the adapter for each supported method', () => {
      expect(
        factory.getAndValidateMethod(PaymentProviderType.BANCO_DO_BRASIL, PaymentMethod.BOLETO),
      ).toBe(bbAdapter);
      expect(
        factory.getAndValidateMethod(PaymentProviderType.BANCO_DO_BRASIL, PaymentMethod.BOLEPIX),
      ).toBe(bbAdapter);
    });

    it('should throw NotFoundException when provider type is not registered', () => {
      const unknownType = 'UNKNOWN_PROVIDER' as PaymentProviderType;
      expect(() =>
        factory.getAndValidateMethod(unknownType, PaymentMethod.PIX),
      ).toThrow(NotFoundException);
    });

    it('should throw UnprocessableEntityException (422) when the method is not supported', () => {
      const pixOnlyAdapter = createStubAdapter(PaymentProviderType.BANCO_DO_BRASIL, [
        { method: PaymentMethod.PIX, supported: true, features: ['immediate'] },
      ]);
      const pixOnlyFactory = new PaymentProviderFactory([pixOnlyAdapter]);

      expect(() =>
        pixOnlyFactory.getAndValidateMethod(
          PaymentProviderType.BANCO_DO_BRASIL,
          PaymentMethod.BOLETO,
        ),
      ).toThrow(UnprocessableEntityException);
      expect(() =>
        pixOnlyFactory.getAndValidateMethod(
          PaymentProviderType.BANCO_DO_BRASIL,
          PaymentMethod.BOLETO,
        ),
      ).toThrow(
        /Payment method "BOLETO" is not supported by provider "BANCO_DO_BRASIL"/,
      );
    });

    it('should throw UnprocessableEntityException when the method exists but supported is false', () => {
      const unsupportedAdapter = createStubAdapter(PaymentProviderType.BANCO_DO_BRASIL, [
        { method: PaymentMethod.PIX, supported: true },
        { method: PaymentMethod.BOLETO, supported: false },
      ]);
      const testFactory = new PaymentProviderFactory([unsupportedAdapter]);

      expect(() =>
        testFactory.getAndValidateMethod(
          PaymentProviderType.BANCO_DO_BRASIL,
          PaymentMethod.BOLETO,
        ),
      ).toThrow(UnprocessableEntityException);
    });
  });

  describe('constructor', () => {
    it('should handle empty adapters array', () => {
      const emptyFactory = new PaymentProviderFactory([]);
      const unknownType = 'ANY' as PaymentProviderType;
      expect(() => emptyFactory.get(unknownType)).toThrow(NotFoundException);
      expect(emptyFactory.supportsMethod(unknownType, PaymentMethod.PIX)).toBe(false);
    });

    it('should register multiple adapters correctly', () => {
      const adapter1 = createStubAdapter(PaymentProviderType.BANCO_DO_BRASIL, [
        { method: PaymentMethod.PIX, supported: true },
      ]);
      const secondType = 'SECOND_PROVIDER' as PaymentProviderType;
      const adapter2 = createStubAdapter(secondType, [
        { method: PaymentMethod.BOLETO, supported: true },
      ]);

      const multiFactory = new PaymentProviderFactory([adapter1, adapter2]);

      expect(multiFactory.get(PaymentProviderType.BANCO_DO_BRASIL)).toBe(adapter1);
      expect(multiFactory.get(secondType)).toBe(adapter2);
      expect(multiFactory.supportsMethod(secondType, PaymentMethod.BOLETO)).toBe(true);
      expect(multiFactory.supportsMethod(secondType, PaymentMethod.PIX)).toBe(false);
    });
  });
});
