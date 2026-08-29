import { Test, TestingModule } from '@nestjs/testing';
import {
  BancoDoBrasilPaymentAdapter,
  BbTimeoutError,
  BbRateLimitedError,
  BbProviderError,
} from './banco-do-brasil-payment.adapter';
import { BancoDoBrasilHttpClient, BbHttpResult } from './bb-http-client.service';
import { BancoDoBrasilAuthService } from './bb-auth.service';
import { PaymentMethod, PaymentChargeStatus, PaymentGatewayEnvironment } from '../../enums';
import { DecryptedGatewayConfig, IssuePaymentChargeInput } from '../types';
import { PaymentChargeEntity } from '../../entities/payment-charge.entity';

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockHttpClient = {
  request: jest.fn(),
};

const mockAuthService = {
  getAccessToken: jest.fn(),
  createHttpsAgent: jest.fn(),
  getAuthenticatedClient: jest.fn(),
  refreshToken: jest.fn(),
};

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const defaultConfig: DecryptedGatewayConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  developerKey: 'test-dev-key',
  pixKey: 'test-pix-key@email.com',
  environment: PaymentGatewayEnvironment.SANDBOX,
  timeoutMs: 30_000,
  maxRetries: 3,
};

function makePixInput(overrides: Partial<IssuePaymentChargeInput> = {}): IssuePaymentChargeInput {
  return {
    contractId: 'contract-123',
    method: PaymentMethod.PIX,
    amount: '150.50',
    dueDate: new Date('2025-03-15'),
    idempotencyKey: 'idem-key-001',
    txid: 'txid1234567890abcdefghij',
    creditor: {
      name: 'Empresa Credora LTDA',
      cnpj: '12.345.678/0001-90',
    },
    debtor: {
      name: 'João da Silva',
      document: '12345678901',
    },
    ...overrides,
  };
}

function makeBoletoInput(overrides: Partial<IssuePaymentChargeInput> = {}): IssuePaymentChargeInput {
  return {
    contractId: 'contract-123',
    method: PaymentMethod.BOLETO,
    amount: '250.00',
    dueDate: new Date('2025-04-01'),
    idempotencyKey: 'idem-key-002',
    debtor: {
      name: 'Maria Souza',
      document: '12345678000195',
      address: {
        street: 'Rua das Flores',
        number: '123',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        zipCode: '01001000',
      },
    },
    ...overrides,
  };
}

function makeChargeEntity(overrides: Partial<PaymentChargeEntity> = {}): PaymentChargeEntity {
  return {
    id: 'charge-id-1',
    accountId: 'account-1',
    contractId: 'contract-123',
    paymentGatewayId: 'gateway-1',
    method: PaymentMethod.PIX,
    status: PaymentChargeStatus.ISSUED,
    amount: '150.50',
    dueDate: new Date('2025-03-15'),
    idempotencyKey: 'idem-key-001',
    externalId: 'txid1234567890abcdefghij',
    externalStatus: 'ATIVA',
    ourNumber: null,
    txid: 'txid1234567890abcdefghij',
    digitableLine: null,
    barcode: null,
    pixCopyPaste: '00020126580014br.gov.bcb.pix...',
    qrCodeUrl: 'https://pix.bb.com.br/qr/v2/abc123',
    documentUrl: null,
    providerPayload: null,
    failureCode: null,
    failureMessage: null,
    issuedAt: new Date('2025-03-14T10:00:00Z'),
    paidAt: null,
    expiresAt: new Date('2025-03-15T10:00:00Z'),
    attributedChannel: null,
    version: 1,
    createdAt: new Date('2025-03-14T10:00:00Z'),
    updatedAt: new Date('2025-03-14T10:00:00Z'),
    ...overrides,
  };
}

// ─── Test Suite ────────────────────────────────────────────────────────────────

describe('BancoDoBrasilPaymentAdapter', () => {
  let adapter: BancoDoBrasilPaymentAdapter;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BancoDoBrasilPaymentAdapter,
        { provide: BancoDoBrasilHttpClient, useValue: mockHttpClient },
        { provide: BancoDoBrasilAuthService, useValue: mockAuthService },
      ],
    }).compile();

    adapter = module.get<BancoDoBrasilPaymentAdapter>(BancoDoBrasilPaymentAdapter);
  });

  // ─── getCapabilities ─────────────────────────────────────────────────────

  describe('getCapabilities', () => {
    it('should return PIX, BOLETO and BOLEPIX as supported', () => {
      const capabilities = adapter.getCapabilities();

      expect(capabilities).toHaveLength(3);
      expect(capabilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: PaymentMethod.PIX, supported: true }),
          expect.objectContaining({ method: PaymentMethod.BOLETO, supported: true }),
          expect.objectContaining({ method: PaymentMethod.BOLEPIX, supported: true }),
        ]),
      );
    });

    it('should include qrCode and copyPaste features for PIX', () => {
      const capabilities = adapter.getCapabilities();
      const pix = capabilities.find((c) => c.method === PaymentMethod.PIX);

      expect(pix?.features).toEqual(['qrCode', 'copyPaste']);
    });
  });

  // ─── validateIssueInput ──────────────────────────────────────────────────

  describe('validateIssueInput', () => {
    describe('PIX validation', () => {
      it('should return no missing fields for a valid PIX input', () => {
        const input = makePixInput();
        const result = adapter.validateIssueInput(input);
        expect(result).toHaveLength(0);
      });

      it('should require debtor.name', () => {
        const input = makePixInput({ debtor: { name: '', document: '12345678901' } });
        const result = adapter.validateIssueInput(input);
        expect(result).toContainEqual({ field: 'debtor.name', reason: 'required' });
      });

      it('should require debtor.document', () => {
        const input = makePixInput({ debtor: { name: 'Test', document: '' } });
        const result = adapter.validateIssueInput(input);
        expect(result).toContainEqual({ field: 'debtor.document', reason: 'required' });
      });

      it('should reject invalid document format', () => {
        const input = makePixInput({ debtor: { name: 'Test', document: '123' } });
        const result = adapter.validateIssueInput(input);
        expect(result).toContainEqual({ field: 'debtor.document', reason: 'invalid_format' });
      });

      it('should accept valid CPF (11 digits)', () => {
        const input = makePixInput({ debtor: { name: 'Test', document: '12345678901' } });
        const result = adapter.validateIssueInput(input);
        expect(result).toHaveLength(0);
      });

      it('should accept valid CNPJ (14 digits)', () => {
        const input = makePixInput({ debtor: { name: 'Test', document: '12345678000195' } });
        const result = adapter.validateIssueInput(input);
        expect(result).toHaveLength(0);
      });

      it('should require positive amount', () => {
        const input = makePixInput({ amount: '0' });
        const result = adapter.validateIssueInput(input);
        expect(result).toContainEqual({ field: 'amount', reason: 'required' });
      });

      it('should reject negative amount', () => {
        const input = makePixInput({ amount: '-10' });
        const result = adapter.validateIssueInput(input);
        expect(result).toContainEqual({ field: 'amount', reason: 'required' });
      });
    });

    describe('BOLETO validation', () => {
      it('should return no missing fields for a valid BOLETO input', () => {
        const input = makeBoletoInput();
        const result = adapter.validateIssueInput(input);
        expect(result).toHaveLength(0);
      });

      it('should require address for BOLETO', () => {
        const input = makeBoletoInput({
          debtor: { name: 'Test', document: '12345678901' },
        });
        const result = adapter.validateIssueInput(input);
        expect(result).toContainEqual({ field: 'debtor.address', reason: 'required' });
      });

      it('should validate individual address fields', () => {
        const input = makeBoletoInput({
          debtor: {
            name: 'Test',
            document: '12345678901',
            address: {
              street: '',
              number: '',
              neighborhood: '',
              city: '',
              state: '',
              zipCode: '',
            },
          },
        });
        const result = adapter.validateIssueInput(input);
        expect(result).toContainEqual({ field: 'debtor.address.street', reason: 'required' });
        expect(result).toContainEqual({ field: 'debtor.address.number', reason: 'required' });
        expect(result).toContainEqual({ field: 'debtor.address.neighborhood', reason: 'required' });
        expect(result).toContainEqual({ field: 'debtor.address.city', reason: 'required' });
        expect(result).toContainEqual({ field: 'debtor.address.state', reason: 'required' });
        expect(result).toContainEqual({ field: 'debtor.address.zipCode', reason: 'required' });
      });
    });

    describe('BOLEPIX validation', () => {
      it('should require both PIX and address fields', () => {
        const input: IssuePaymentChargeInput = {
          contractId: 'contract-123',
          method: PaymentMethod.BOLEPIX,
          amount: '100.00',
          dueDate: new Date(),
          idempotencyKey: 'key-1',
          debtor: { name: '', document: '' },
        };
        const result = adapter.validateIssueInput(input);
        expect(result.some((m) => m.field === 'debtor.name')).toBe(true);
        expect(result.some((m) => m.field === 'debtor.document')).toBe(true);
        expect(result.some((m) => m.field === 'debtor.address')).toBe(true);
      });
    });
  });

  // ─── issue ───────────────────────────────────────────────────────────────

  describe('issue', () => {
    const successResponse: BbHttpResult<any> = {
      outcome: 'SUCCESS',
      statusCode: 201,
      data: {
        txid: 'txid1234567890abcdefghij',
        status: 'ATIVA',
        calendario: { criacao: '2025-03-14T10:00:00Z', expiracao: 86400 },
        devedor: { cpf: '12345678901', nome: 'João da Silva' },
        valor: { original: '150.50' },
        chave: 'test-pix-key@email.com',
        pixCopiaECola: '00020126580014br.gov.bcb.pix...',
        location: 'https://pix.bb.com.br/qr/v2/abc123',
      },
    };

    it('should call PUT /cob/{txid} with correct payload', async () => {
      mockHttpClient.request.mockResolvedValue(successResponse);

      const input = makePixInput();
      await adapter.issue(input, defaultConfig);

      expect(mockHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          url: 'https://api-pix.hm.bb.com.br/pix/v2/cob/txid1234567890abcdefghij',
          data: expect.objectContaining({
            calendario: { expiracao: 86400 },
            devedor: { cpf: '12345678901', nome: 'João da Silva' },
            valor: { original: '150.50' },
            chave: 'test-pix-key@email.com',
            solicitacaoPagador: 'Dívida. Credor: Empresa Credora LTDA. CNPJ: 12345678000190',
          }),
          gatewayConfig: defaultConfig,
        }),
      );
    });

    it('should use CNPJ field when document has 14 digits', async () => {
      mockHttpClient.request.mockResolvedValue(successResponse);

      const input = makePixInput({
        debtor: { name: 'Empresa LTDA', document: '12345678000195' },
      });
      await adapter.issue(input, defaultConfig);

      const call = mockHttpClient.request.mock.calls[0][0];
      expect(call.data.devedor).toEqual({ cnpj: '12345678000195', nome: 'Empresa LTDA' });
    });

    it('should use CPF field when document has 11 digits', async () => {
      mockHttpClient.request.mockResolvedValue(successResponse);

      const input = makePixInput();
      await adapter.issue(input, defaultConfig);

      const call = mockHttpClient.request.mock.calls[0][0];
      expect(call.data.devedor).toEqual({ cpf: '12345678901', nome: 'João da Silva' });
    });

    it('should strip non-numeric characters from document', async () => {
      mockHttpClient.request.mockResolvedValue(successResponse);

      const input = makePixInput({
        debtor: { name: 'Test', document: '123.456.789-01' },
      });
      await adapter.issue(input, defaultConfig);

      const call = mockHttpClient.request.mock.calls[0][0];
      expect(call.data.devedor.cpf).toBe('12345678901');
    });

    it('should return IssuedPaymentCharge on SUCCESS', async () => {
      mockHttpClient.request.mockResolvedValue(successResponse);

      const input = makePixInput();
      const result = await adapter.issue(input, defaultConfig);

      expect(result.txid).toBe('txid1234567890abcdefghij');
      expect(result.externalId).toBe('txid1234567890abcdefghij');
      expect(result.externalStatus).toBe('ATIVA');
      expect(result.pixCopyPaste).toBe('00020126580014br.gov.bcb.pix...');
      expect(result.qrCodeUrl).toBe('https://pix.bb.com.br/qr/v2/abc123');
      expect(result.issuedAt).toBeInstanceOf(Date);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should use default 24h expiration when expiresAt is not provided', async () => {
      mockHttpClient.request.mockResolvedValue(successResponse);

      const input = makePixInput({ expiresAt: undefined });
      await adapter.issue(input, defaultConfig);

      const call = mockHttpClient.request.mock.calls[0][0];
      expect(call.data.calendario.expiracao).toBe(86400);
    });

    it('should calculate expiration from expiresAt when provided', async () => {
      mockHttpClient.request.mockResolvedValue(successResponse);

      const futureDate = new Date(Date.now() + 3600 * 1_000); // 1 hour from now
      const input = makePixInput({ expiresAt: futureDate });
      await adapter.issue(input, defaultConfig);

      const call = mockHttpClient.request.mock.calls[0][0];
      // Should be approximately 3600 seconds (±2s for test execution time)
      expect(call.data.calendario.expiracao).toBeGreaterThan(3590);
      expect(call.data.calendario.expiracao).toBeLessThanOrEqual(3600);
    });

    it('should throw BbTimeoutError on TIMEOUT outcome', async () => {
      mockHttpClient.request.mockResolvedValue({ outcome: 'TIMEOUT' });

      const input = makePixInput();
      await expect(adapter.issue(input, defaultConfig)).rejects.toThrow(BbTimeoutError);
    });

    it('should throw BbRateLimitedError on RATE_LIMITED outcome', async () => {
      mockHttpClient.request.mockResolvedValue({
        outcome: 'RATE_LIMITED',
        lastStatusCode: 429,
      });

      const input = makePixInput();
      await expect(adapter.issue(input, defaultConfig)).rejects.toThrow(BbRateLimitedError);
    });

    it('should throw BbProviderError on PROVIDER_ERROR outcome', async () => {
      mockHttpClient.request.mockResolvedValue({
        outcome: 'PROVIDER_ERROR',
        statusCode: 400,
        errorBody: { title: 'Invalid txid format' },
      });

      const input = makePixInput();
      await expect(adapter.issue(input, defaultConfig)).rejects.toThrow(BbProviderError);
    });

    it('should sanitize error message from provider', async () => {
      mockHttpClient.request.mockResolvedValue({
        outcome: 'PROVIDER_ERROR',
        statusCode: 422,
        errorBody: { title: 'Chave Pix inválida' },
      });

      const input = makePixInput();
      try {
        await adapter.issue(input, defaultConfig);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BbProviderError);
        expect((error as BbProviderError).message).toBe('Chave Pix inválida');
        expect((error as BbProviderError).failureCode).toBe('BB_422');
      }
    });

    it('should use fallback message when errorBody has no title/detail', async () => {
      mockHttpClient.request.mockResolvedValue({
        outcome: 'PROVIDER_ERROR',
        statusCode: 500,
        errorBody: { unexpected: 'field' },
      });

      const input = makePixInput();
      try {
        await adapter.issue(input, defaultConfig);
        fail('Should have thrown');
      } catch (error) {
        expect((error as BbProviderError).message).toBe('Provider returned an error');
      }
    });

    it('should format amount to two decimal places', async () => {
      mockHttpClient.request.mockResolvedValue(successResponse);

      const input = makePixInput({ amount: '100' });
      await adapter.issue(input, defaultConfig);

      const call = mockHttpClient.request.mock.calls[0][0];
      expect(call.data.valor.original).toBe('100.00');
    });
  });

  // ─── fetchStatus ─────────────────────────────────────────────────────────

  describe('fetchStatus', () => {
    it('should call GET /cob/{txid}', async () => {
      mockHttpClient.request.mockResolvedValue({
        outcome: 'SUCCESS',
        statusCode: 200,
        data: {
          txid: 'txid1234567890abcdefghij',
          status: 'ATIVA',
          calendario: { criacao: '2025-03-14T10:00:00Z', expiracao: 86400 },
          devedor: { cpf: '12345678901', nome: 'João' },
          valor: { original: '150.50' },
          chave: 'key',
        },
      });

      const charge = makeChargeEntity();
      await adapter.fetchStatus(charge, defaultConfig);

      expect(mockHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: 'https://api-pix.hm.bb.com.br/pix/v2/cob/txid1234567890abcdefghij',
          gatewayConfig: defaultConfig,
        }),
      );
    });

    it('should map ATIVA to ISSUED', async () => {
      mockHttpClient.request.mockResolvedValue({
        outcome: 'SUCCESS',
        statusCode: 200,
        data: {
          txid: 'txid1234567890abcdefghij',
          status: 'ATIVA',
          calendario: { criacao: '2025-03-14T10:00:00Z', expiracao: 86400 },
          devedor: { cpf: '12345678901', nome: 'João' },
          valor: { original: '150.50' },
          chave: 'key',
        },
      });

      const charge = makeChargeEntity();
      const result = await adapter.fetchStatus(charge, defaultConfig);

      expect(result.status).toBe(PaymentChargeStatus.ISSUED);
      expect(result.externalStatus).toBe('ATIVA');
    });

    it('should map CONCLUIDA to PAID', async () => {
      mockHttpClient.request.mockResolvedValue({
        outcome: 'SUCCESS',
        statusCode: 200,
        data: {
          txid: 'txid1234567890abcdefghij',
          status: 'CONCLUIDA',
          calendario: { criacao: '2025-03-14T10:00:00Z', expiracao: 86400 },
          devedor: { cpf: '12345678901', nome: 'João' },
          valor: { original: '150.50' },
          chave: 'key',
        },
      });

      const charge = makeChargeEntity();
      const result = await adapter.fetchStatus(charge, defaultConfig);

      expect(result.status).toBe(PaymentChargeStatus.PAID);
    });

    it('should map REMOVIDA_PELO_USUARIO_RECEBEDOR to CANCELLED', async () => {
      mockHttpClient.request.mockResolvedValue({
        outcome: 'SUCCESS',
        statusCode: 200,
        data: {
          txid: 'txid1234567890abcdefghij',
          status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR',
          calendario: { criacao: '2025-03-14T10:00:00Z', expiracao: 86400 },
          devedor: { cpf: '12345678901', nome: 'João' },
          valor: { original: '150.50' },
          chave: 'key',
        },
      });

      const charge = makeChargeEntity();
      const result = await adapter.fetchStatus(charge, defaultConfig);

      expect(result.status).toBe(PaymentChargeStatus.CANCELLED);
    });

    it('should default unknown BB status to ISSUED', async () => {
      mockHttpClient.request.mockResolvedValue({
        outcome: 'SUCCESS',
        statusCode: 200,
        data: {
          txid: 'txid1234567890abcdefghij',
          status: 'SOME_UNKNOWN_STATUS',
          calendario: { criacao: '2025-03-14T10:00:00Z', expiracao: 86400 },
          devedor: { cpf: '12345678901', nome: 'João' },
          valor: { original: '150.50' },
          chave: 'key',
        },
      });

      const charge = makeChargeEntity();
      const result = await adapter.fetchStatus(charge, defaultConfig);

      expect(result.status).toBe(PaymentChargeStatus.ISSUED);
      expect(result.externalStatus).toBe('SOME_UNKNOWN_STATUS');
    });

    it('should throw BbTimeoutError on TIMEOUT', async () => {
      mockHttpClient.request.mockResolvedValue({ outcome: 'TIMEOUT' });

      const charge = makeChargeEntity();
      await expect(adapter.fetchStatus(charge, defaultConfig)).rejects.toThrow(BbTimeoutError);
    });

    it('should throw BbRateLimitedError on RATE_LIMITED', async () => {
      mockHttpClient.request.mockResolvedValue({
        outcome: 'RATE_LIMITED',
        lastStatusCode: 429,
      });

      const charge = makeChargeEntity();
      await expect(adapter.fetchStatus(charge, defaultConfig)).rejects.toThrow(BbRateLimitedError);
    });

    it('should throw BbProviderError on PROVIDER_ERROR', async () => {
      mockHttpClient.request.mockResolvedValue({
        outcome: 'PROVIDER_ERROR',
        statusCode: 404,
        errorBody: { title: 'Cobrança não encontrada' },
      });

      const charge = makeChargeEntity();
      await expect(adapter.fetchStatus(charge, defaultConfig)).rejects.toThrow(BbProviderError);
    });
  });

  // ─── providerType ────────────────────────────────────────────────────────

  describe('providerType', () => {
    it('should be BANCO_DO_BRASIL', () => {
      expect(adapter.providerType).toBe('BANCO_DO_BRASIL');
    });
  });
});
