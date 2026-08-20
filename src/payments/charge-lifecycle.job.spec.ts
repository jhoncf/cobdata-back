import { Test, TestingModule } from '@nestjs/testing';
import { ChargeLifecycleJob, ChargeLifecycleJobResult } from './charge-lifecycle.job';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGatewaysService } from './payment-gateways.service';
import { PaymentProviderFactory } from './adapters/payment-provider.factory';
import { PaymentChargeStatus, PaymentMethod, PaymentChargeChannel } from './enums';
import {
  BbTimeoutError,
  BbRateLimitedError,
} from './adapters/banco-do-brasil/banco-do-brasil-payment.adapter';

// ─── Mock Helpers ──────────────────────────────────────────────────────────────

function buildCharge(overrides: Partial<Record<string, any>> = {}) {
  const now = new Date();
  return {
    id: 'charge-1',
    accountId: 'account-1',
    contractId: 'contract-1',
    paymentGatewayId: 'gateway-1',
    method: PaymentMethod.PIX,
    status: PaymentChargeStatus.PENDING,
    amount: '100.00',
    dueDate: new Date(now.getTime() + 86_400_000),
    idempotencyKey: 'idem-1',
    externalId: 'ext-1',
    externalStatus: null,
    ourNumber: null,
    txid: 'txid-1',
    digitableLine: null,
    barcode: null,
    pixCopyPaste: 'pix-copy-paste',
    qrCodeUrl: null,
    documentUrl: null,
    providerPayload: null,
    failureCode: null,
    failureMessage: null,
    issuedAt: null,
    paidAt: null,
    expiresAt: null,
    attributedChannel: PaymentChargeChannel.COBCOM,
    version: 1,
    createdAt: new Date(now.getTime() - 10 * 60 * 1_000), // 10 minutes ago
    updatedAt: now,
    ...overrides,
  };
}

function buildGateway() {
  return {
    id: 'gateway-1',
    accountId: 'account-1',
    name: 'BB Gateway',
    providerType: 'BANCO_DO_BRASIL',
    environment: 'SANDBOX',
    enabled: true,
    supportedMethods: ['PIX'],
    pixKey: 'encrypted-pix-key',
    encryptedCredentials: 'encrypted-creds',
    timeoutMs: 30000,
    maxRetries: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('ChargeLifecycleJob', () => {
  let job: ChargeLifecycleJob;
  let prisma: any;
  let gatewaysService: any;
  let providerFactory: any;
  let mockAdapter: any;

  beforeEach(async () => {
    mockAdapter = {
      providerType: 'BANCO_DO_BRASIL',
      fetchStatus: jest.fn(),
    };

    prisma = {
      paymentCharge: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      paymentGateway: {
        findUnique: jest.fn().mockResolvedValue(buildGateway()),
      },
      paymentEvent: {
        create: jest.fn().mockResolvedValue({}),
      },
      paymentSettlement: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    gatewaysService = {
      decryptCredentials: jest.fn().mockReturnValue({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        developerKey: 'dev-key',
        pixKey: 'pix-key',
        environment: 'SANDBOX',
        timeoutMs: 30000,
        maxRetries: 3,
      }),
    };

    providerFactory = {
      get: jest.fn().mockReturnValue(mockAdapter),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChargeLifecycleJob,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentGatewaysService, useValue: gatewaysService },
        { provide: PaymentProviderFactory, useValue: providerFactory },
      ],
    }).compile();

    job = module.get<ChargeLifecycleJob>(ChargeLifecycleJob);
  });

  describe('execute', () => {
    it('should process an empty batch without errors', async () => {
      prisma.paymentCharge.findMany.mockResolvedValue([]);

      const result = await job.execute();

      expect(result.processedCount).toBe(0);
      expect(result.providerErrors).toBe(0);
    });

    // ─── 6.2: PENDING reconciliation ──────────────────────────────────────────

    it('should transition PENDING → ISSUED when provider confirms registration', async () => {
      const charge = buildCharge({ status: PaymentChargeStatus.PENDING });
      prisma.paymentCharge.findMany
        .mockResolvedValueOnce([charge]) // pending charges
        .mockResolvedValueOnce([]); // expired charges

      mockAdapter.fetchStatus.mockResolvedValue({
        status: PaymentChargeStatus.ISSUED,
        externalStatus: 'ATIVA',
        providerPayload: { status: 'ATIVA' },
      });

      const result = await job.execute();

      expect(result.processedCount).toBe(1);
      expect(result.transitionedToIssued).toBe(1);
      expect(prisma.paymentCharge.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: charge.id, version: charge.version },
          data: expect.objectContaining({ status: PaymentChargeStatus.ISSUED }),
        }),
      );
      expect(prisma.paymentEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentChargeId: charge.id,
            fromStatus: PaymentChargeStatus.PENDING,
            toStatus: PaymentChargeStatus.ISSUED,
            source: 'JOB',
          }),
        }),
      );
    });

    it('should transition PENDING → PAID and create settlement when provider confirms payment', async () => {
      const charge = buildCharge({ status: PaymentChargeStatus.PENDING });
      const paidAt = new Date();
      prisma.paymentCharge.findMany
        .mockResolvedValueOnce([charge])
        .mockResolvedValueOnce([]);

      mockAdapter.fetchStatus.mockResolvedValue({
        status: PaymentChargeStatus.PAID,
        externalStatus: 'CONCLUIDA',
        paidAt,
        providerPayload: { status: 'CONCLUIDA' },
      });

      const result = await job.execute();

      expect(result.processedCount).toBe(1);
      expect(result.transitionedToPaid).toBe(1);
      expect(prisma.paymentCharge.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: charge.id, version: charge.version },
          data: expect.objectContaining({
            status: PaymentChargeStatus.PAID,
            paidAt,
          }),
        }),
      );
      // Settlement created
      expect(prisma.paymentSettlement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountId: charge.accountId,
            contractId: charge.contractId,
            paymentChargeId: charge.id,
            amount: charge.amount.toString(),
            paidAt,
          }),
        }),
      );
    });

    it('should transition PENDING → FAILED when provider does not know the charge', async () => {
      const charge = buildCharge({ status: PaymentChargeStatus.PENDING });
      prisma.paymentCharge.findMany
        .mockResolvedValueOnce([charge])
        .mockResolvedValueOnce([]);

      mockAdapter.fetchStatus.mockResolvedValue({
        status: PaymentChargeStatus.FAILED,
        failureCode: 'PROVIDER_NOT_PROCESSED',
        failureMessage: 'Charge not found at provider',
      });

      const result = await job.execute();

      expect(result.processedCount).toBe(1);
      expect(result.transitionedToFailed).toBe(1);
      expect(prisma.paymentCharge.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: charge.id, version: charge.version },
          data: expect.objectContaining({
            status: PaymentChargeStatus.FAILED,
            failureCode: 'PROVIDER_NOT_PROCESSED',
          }),
        }),
      );
    });

    // ─── 6.3: Expired reconciliation ──────────────────────────────────────────

    it('should transition expired charge → EXPIRED after provider confirms not paid', async () => {
      const expiredCharge = buildCharge({
        status: PaymentChargeStatus.ISSUED,
        expiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
        createdAt: new Date(Date.now() - 86_400_000), // 1 day ago
      });

      prisma.paymentCharge.findMany
        .mockResolvedValueOnce([]) // no pending
        .mockResolvedValueOnce([expiredCharge]); // expired

      mockAdapter.fetchStatus.mockResolvedValue({
        status: PaymentChargeStatus.ISSUED, // provider says still ATIVA (not paid)
        externalStatus: 'ATIVA',
      });

      const result = await job.execute();

      expect(result.processedCount).toBe(1);
      expect(result.transitionedToExpired).toBe(1);
      expect(prisma.paymentCharge.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: expiredCharge.id, version: expiredCharge.version },
          data: expect.objectContaining({ status: PaymentChargeStatus.EXPIRED }),
        }),
      );
    });

    it('should transition expired charge → PAID when provider confirms late payment', async () => {
      const expiredCharge = buildCharge({
        status: PaymentChargeStatus.ISSUED,
        expiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
        createdAt: new Date(Date.now() - 86_400_000), // 1 day ago
      });
      const paidAt = new Date();

      prisma.paymentCharge.findMany
        .mockResolvedValueOnce([]) // no pending timeout candidates
        .mockResolvedValueOnce([expiredCharge]); // expired

      mockAdapter.fetchStatus.mockResolvedValue({
        status: PaymentChargeStatus.PAID,
        externalStatus: 'CONCLUIDA',
        paidAt,
      });

      const result = await job.execute();

      expect(result.processedCount).toBe(1);
      expect(result.transitionedToPaid).toBe(1);
      expect(prisma.paymentSettlement.create).toHaveBeenCalled();
    });

    // ─── 6.4: Protections ─────────────────────────────────────────────────────

    it('should NOT transition when provider is unavailable (timeout)', async () => {
      const charge = buildCharge({ status: PaymentChargeStatus.PENDING });
      prisma.paymentCharge.findMany
        .mockResolvedValueOnce([charge])
        .mockResolvedValueOnce([]);

      mockAdapter.fetchStatus.mockRejectedValue(new BbTimeoutError());

      const result = await job.execute();

      expect(result.processedCount).toBe(1);
      expect(result.providerErrors).toBe(1);
      expect(result.transitionedToPaid).toBe(0);
      expect(result.transitionedToFailed).toBe(0);
      expect(result.transitionedToIssued).toBe(0);
      expect(prisma.paymentCharge.updateMany).not.toHaveBeenCalled();
    });

    it('should NOT stop batch on individual charge error', async () => {
      const charge1 = buildCharge({ id: 'charge-1', status: PaymentChargeStatus.PENDING });
      const charge2 = buildCharge({ id: 'charge-2', status: PaymentChargeStatus.PENDING });

      prisma.paymentCharge.findMany
        .mockResolvedValueOnce([charge1, charge2])
        .mockResolvedValueOnce([]);

      // First charge throws unrecoverable error, second succeeds
      mockAdapter.fetchStatus
        .mockRejectedValueOnce(new Error('Unexpected DB failure'))
        .mockResolvedValueOnce({
          status: PaymentChargeStatus.ISSUED,
          externalStatus: 'ATIVA',
        });

      // Need separate gateway lookups
      prisma.paymentGateway.findUnique
        .mockResolvedValueOnce(buildGateway())
        .mockResolvedValueOnce(buildGateway());

      const result = await job.execute();

      // Both attempted, one failed, one succeeded
      expect(result.processedCount).toBe(1); // only the successful one counts
      expect(result.providerErrors).toBe(1);
      expect(result.transitionedToIssued).toBe(1);
    });

    it('should use optimistic locking with version field on updates', async () => {
      const charge = buildCharge({ status: PaymentChargeStatus.PENDING, version: 3 });
      prisma.paymentCharge.findMany
        .mockResolvedValueOnce([charge])
        .mockResolvedValueOnce([]);

      mockAdapter.fetchStatus.mockResolvedValue({
        status: PaymentChargeStatus.ISSUED,
        externalStatus: 'ATIVA',
      });

      await job.execute();

      expect(prisma.paymentCharge.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: charge.id, version: 3 },
          data: expect.objectContaining({ version: { increment: 1 } }),
        }),
      );
    });

    it('should log warning on optimistic lock conflict and continue', async () => {
      const charge = buildCharge({ status: PaymentChargeStatus.PENDING });
      prisma.paymentCharge.findMany
        .mockResolvedValueOnce([charge])
        .mockResolvedValueOnce([]);

      mockAdapter.fetchStatus.mockResolvedValue({
        status: PaymentChargeStatus.ISSUED,
        externalStatus: 'ATIVA',
      });

      // Simulate version conflict
      prisma.paymentCharge.updateMany.mockResolvedValue({ count: 0 });

      const result = await job.execute();

      // Still counts as processed (attempt was made)
      expect(result.processedCount).toBe(1);
      expect(result.transitionedToIssued).toBe(1);
    });
  });
});
