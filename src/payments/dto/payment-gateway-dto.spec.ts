import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreatePaymentGatewayDto } from './create-payment-gateway.dto';
import { UpdatePaymentGatewayDto } from './update-payment-gateway.dto';
import { PaymentGatewayResponseDto } from './payment-gateway-response.dto';
import { PaymentProviderType, PaymentMethod, PaymentGatewayEnvironment } from '../enums';

describe('CreatePaymentGatewayDto', () => {
  const validInput = {
    name: 'Banco do Brasil - Produção',
    providerType: PaymentProviderType.BANCO_DO_BRASIL,
    environment: PaymentGatewayEnvironment.PRODUCTION,
    enabled: true,
    supportedMethods: [PaymentMethod.PIX, PaymentMethod.BOLETO],
    credentials: {
      clientId: 'my-client-id',
      clientSecret: 'my-client-secret',
      developerKey: 'my-dev-key',
    },
  };

  it('should pass validation with valid input', async () => {
    const dto = plainToInstance(CreatePaymentGatewayDto, validInput);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail when name is shorter than 3 characters', async () => {
    const dto = plainToInstance(CreatePaymentGatewayDto, { ...validInput, name: 'AB' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const firstErr = errors[0];
    expect(firstErr!.property).toBe('name');
  });

  it('should fail when name is empty', async () => {
    const dto = plainToInstance(CreatePaymentGatewayDto, { ...validInput, name: '' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const firstErr = errors[0];
    expect(firstErr!.property).toBe('name');
  });

  it('should fail with invalid providerType', async () => {
    const dto = plainToInstance(CreatePaymentGatewayDto, { ...validInput, providerType: 'INVALID' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'providerType')).toBe(true);
  });

  it('should fail with invalid environment', async () => {
    const dto = plainToInstance(CreatePaymentGatewayDto, { ...validInput, environment: 'INVALID' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'environment')).toBe(true);
  });

  it('should fail when supportedMethods is empty', async () => {
    const dto = plainToInstance(CreatePaymentGatewayDto, { ...validInput, supportedMethods: [] });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'supportedMethods')).toBe(true);
  });

  it('should fail when supportedMethods contains invalid value', async () => {
    const dto = plainToInstance(CreatePaymentGatewayDto, { ...validInput, supportedMethods: ['INVALID'] });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'supportedMethods')).toBe(true);
  });

  it('should fail when credentials are missing required fields', async () => {
    const dto = plainToInstance(CreatePaymentGatewayDto, {
      ...validInput,
      credentials: { clientId: 'id' },
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'credentials')).toBe(true);
  });

  it('should allow enabled to be optional (defaults undefined)', async () => {
    const { enabled, ...inputWithoutEnabled } = validInput;
    const dto = plainToInstance(CreatePaymentGatewayDto, inputWithoutEnabled);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should allow optional credential fields', async () => {
    const dto = plainToInstance(CreatePaymentGatewayDto, {
      ...validInput,
      credentials: {
        ...validInput.credentials,
        pixKey: 'my-pix-key@email.com',
      },
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});

describe('UpdatePaymentGatewayDto', () => {
  it('should pass validation with all fields optional (empty object)', async () => {
    const dto = plainToInstance(UpdatePaymentGatewayDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should pass validation with partial fields', async () => {
    const dto = plainToInstance(UpdatePaymentGatewayDto, {
      name: 'Updated Name',
      enabled: false,
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail when name is provided but too short', async () => {
    const dto = plainToInstance(UpdatePaymentGatewayDto, { name: 'AB' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const firstErr = errors[0];
    expect(firstErr!.property).toBe('name');
  });

  it('should fail when supportedMethods is provided as empty array', async () => {
    const dto = plainToInstance(UpdatePaymentGatewayDto, { supportedMethods: [] });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'supportedMethods')).toBe(true);
  });
});

describe('PaymentGatewayResponseDto', () => {
  it('should map entity to response DTO without exposing credentials', () => {
    const entity = {
      id: 'gw-123',
      accountId: 'acc-456',
      name: 'BB Production',
      providerType: PaymentProviderType.BANCO_DO_BRASIL,
      environment: PaymentGatewayEnvironment.PRODUCTION,
      enabled: true,
      supportedMethods: [PaymentMethod.PIX, PaymentMethod.BOLETO],
      pixKey: 'encrypted-pix-key',
      encryptedCredentials: 'encrypted-blob',
      timeoutMs: 30000,
      maxRetries: 3,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-06-01'),
      _decryptedCredentials: { certificateBase64: 'some-cert' },
    };

    const dto = PaymentGatewayResponseDto.fromEntity(entity);

    expect(dto.id).toBe('gw-123');
    expect(dto.accountId).toBe('acc-456');
    expect(dto.name).toBe('BB Production');
    expect(dto.providerType).toBe(PaymentProviderType.BANCO_DO_BRASIL);
    expect(dto.environment).toBe(PaymentGatewayEnvironment.PRODUCTION);
    expect(dto.enabled).toBe(true);
    expect(dto.supportedMethods).toEqual([PaymentMethod.PIX, PaymentMethod.BOLETO]);
    expect(dto.timeoutMs).toBe(30000);
    expect(dto.maxRetries).toBe(3);
    expect(dto.hasCredentials).toBe(true);
    expect(dto.hasPixKey).toBe(true);
    expect(dto.hasCertificate).toBe(true);
    expect(dto.createdAt).toEqual(new Date('2024-01-01'));
    expect(dto.updatedAt).toEqual(new Date('2024-06-01'));

    // Verify no credentials are exposed
    expect((dto as any).encryptedCredentials).toBeUndefined();
    expect((dto as any).pixKey).toBeUndefined();
    expect((dto as any).credentials).toBeUndefined();
    expect((dto as any).clientId).toBeUndefined();
    expect((dto as any).clientSecret).toBeUndefined();
  });

  it('should set hasPixKey to false when pixKey is null', () => {
    const entity = {
      id: 'gw-123',
      accountId: 'acc-456',
      name: 'BB Sandbox',
      providerType: PaymentProviderType.BANCO_DO_BRASIL,
      environment: PaymentGatewayEnvironment.SANDBOX,
      enabled: false,
      supportedMethods: [PaymentMethod.PIX],
      pixKey: null,
      encryptedCredentials: 'encrypted-blob',
      timeoutMs: 30000,
      maxRetries: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      _decryptedCredentials: null,
    };

    const dto = PaymentGatewayResponseDto.fromEntity(entity);

    expect(dto.hasPixKey).toBe(false);
    expect(dto.hasCertificate).toBe(false);
    expect(dto.hasCredentials).toBe(true);
  });

  it('should set hasCredentials to false when encryptedCredentials is empty', () => {
    const entity = {
      id: 'gw-123',
      accountId: 'acc-456',
      name: 'BB Test',
      providerType: PaymentProviderType.BANCO_DO_BRASIL,
      environment: PaymentGatewayEnvironment.SANDBOX,
      enabled: false,
      supportedMethods: [PaymentMethod.BOLETO],
      pixKey: null,
      encryptedCredentials: '',
      timeoutMs: 30000,
      maxRetries: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      _decryptedCredentials: null,
    };

    const dto = PaymentGatewayResponseDto.fromEntity(entity);

    expect(dto.hasCredentials).toBe(false);
  });
});
