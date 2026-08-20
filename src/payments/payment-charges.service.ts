import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGatewaysService } from './payment-gateways.service';
import { PaymentProviderFactory } from './adapters/payment-provider.factory';
import { AuditService } from '../audit/audit.service';
import {
  PaymentMethod,
  PaymentChargeStatus,
  PaymentChargeChannel,
  PaymentEventSource,
  PaymentSettlementSource,
  PaymentSettlementStatus,
  PaymentGatewayEnvironment,
} from './enums';
import { IssuePaymentChargeInput } from './adapters/types';
import { CreatePaymentChargeDto } from './dto/create-payment-charge.dto';
import { GeneratePixByDocumentDto } from './dto/generate-pix-by-document.dto';
import {
  BbTimeoutError,
  BbRateLimitedError,
  BbProviderError,
} from './adapters/banco-do-brasil/banco-do-brasil-payment.adapter';

/** Default Pix expiration in hours — configurable via env PIX_EXPIRATION_HOURS */
const DEFAULT_PIX_EXPIRATION_HOURS = 24;

/**
 * Generates a txid for Pix charges.
 * UUID v4 without dashes, 32 alphanumeric chars (within the 26-35 char range).
 */
function generateTxid(): string {
  return randomUUID().replace(/-/g, '');
}

/**
 * Converts a Record to Prisma-compatible JSON input.
 */
function toJsonInput(
  payload: Record<string, unknown> | undefined | null,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (payload === null) return Prisma.JsonNull;
  if (payload === undefined) return undefined;
  return payload as unknown as Prisma.InputJsonValue;
}

@Injectable()
export class PaymentChargesService {
  private readonly logger = new Logger(PaymentChargesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentGatewaysService: PaymentGatewaysService,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {}

  // ─── 5.1 — Pre-validation (Preflight) ─────────────────────────────────────

  /**
   * Validates contract data for charge issuance without calling the provider.
   * Returns a list of missing/invalid fields.
   */
  async preflight(
    contractId: string,
    method: PaymentMethod,
    paymentGatewayId: string,
    accountId: string,
  ) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, accountId, deletedAt: null },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    // Resolve gateway and adapter
    const gateway = await this.prisma.paymentGateway.findFirst({
      where: { id: paymentGatewayId, accountId, enabled: true },
    });

    if (!gateway) {
      throw new NotFoundException('Payment gateway not found or not enabled');
    }

    const adapter = this.providerFactory.getAndValidateMethod(
      gateway.providerType as any,
      method,
    );

    // Build input from contract data for validation
    const input: IssuePaymentChargeInput = {
      contractId: contract.id,
      method,
      amount: contract.updatedValue?.toString() ?? contract.originalValue.toString(),
      dueDate: contract.dueDate ?? new Date(),
      idempotencyKey: 'preflight',
      debtor: {
        name: contract.debtorName,
        document: contract.debtorDocument,
        email: contract.debtorEmail ?? undefined,
        phone: contract.debtorPhone ?? undefined,
        address: contract.debtorStreet
          ? {
              street: contract.debtorStreet,
              number: (contract as any).debtorAddressNumber ?? '',
              complement: (contract as any).debtorAddressComplement ?? undefined,
              neighborhood: (contract as any).debtorNeighborhood ?? '',
              city: contract.debtorCity ?? '',
              state: (contract as any).debtorState ?? '',
              zipCode: (contract as any).debtorZipCode ?? '',
            }
          : undefined,
      },
    };

    const missingFields = adapter.validateIssueInput(input);
    return missingFields;
  }

  // ─── 5.2 — Generic Charge Issuance via CRM ────────────────────────────────

  /**
   * Issues a payment charge for a contract.
   * Handles idempotency, adapter errors, and audit logging.
   */
  async createCharge(
    contractId: string,
    dto: CreatePaymentChargeDto,
    accountId: string,
    userId: string,
    requestId: string,
  ) {
    // Validate amount is positive
    const amount = parseFloat(dto.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new BadRequestException('Amount must be a positive number');
    }

    // Validate due date
    const dueDate = new Date(dto.dueDate);
    if (isNaN(dueDate.getTime())) {
      throw new BadRequestException('Invalid due date');
    }

    // Resolve gateway
    const gateway = await this.prisma.paymentGateway.findFirst({
      where: { id: dto.paymentGatewayId, accountId, enabled: true },
    });

    if (!gateway) {
      throw new NotFoundException('Payment gateway not found or not enabled');
    }

    // Validate method via factory
    const adapter = this.providerFactory.getAndValidateMethod(
      gateway.providerType as any,
      dto.method,
    );

    // Check idempotency
    const existingCharge = await this.prisma.paymentCharge.findUnique({
      where: {
        idempotencyKey_paymentGatewayId: {
          idempotencyKey: dto.idempotencyKey,
          paymentGatewayId: dto.paymentGatewayId,
        },
      },
    });

    if (existingCharge) {
      return existingCharge;
    }

    // Resolve contract
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, accountId, deletedAt: null },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    // Decrypt gateway config
    const config = this.paymentGatewaysService.decryptCredentials(gateway);

    // Generate txid for Pix methods
    const txid = (dto.method === PaymentMethod.PIX || dto.method === PaymentMethod.BOLEPIX)
      ? generateTxid()
      : undefined;

    // Calculate expiration for Pix
    const pixExpirationHours = parseInt(process.env.PIX_EXPIRATION_HOURS ?? '', 10) || DEFAULT_PIX_EXPIRATION_HOURS;
    const expiresAt = (dto.method === PaymentMethod.PIX || dto.method === PaymentMethod.BOLEPIX)
      ? new Date(Date.now() + pixExpirationHours * 60 * 60 * 1000)
      : undefined;

    // Build input
    const input: IssuePaymentChargeInput = {
      contractId: contract.id,
      method: dto.method,
      amount: dto.amount,
      dueDate,
      idempotencyKey: dto.idempotencyKey,
      txid,
      expiresAt,
      debtor: {
        name: contract.debtorName,
        document: contract.debtorDocument,
        email: contract.debtorEmail ?? undefined,
        phone: contract.debtorPhone ?? undefined,
        address: contract.debtorStreet
          ? {
              street: contract.debtorStreet,
              number: (contract as any).debtorAddressNumber ?? '',
              complement: (contract as any).debtorAddressComplement ?? undefined,
              neighborhood: (contract as any).debtorNeighborhood ?? '',
              city: contract.debtorCity ?? '',
              state: (contract as any).debtorState ?? '',
              zipCode: (contract as any).debtorZipCode ?? '',
            }
          : undefined,
      },
    };

    // Call adapter
    try {
      const issued = await adapter.issue(input, config);

      // Persist charge as ISSUED
      const charge = await this.prisma.paymentCharge.create({
        data: {
          accountId,
          contractId: contract.id,
          paymentGatewayId: dto.paymentGatewayId,
          method: dto.method,
          status: PaymentChargeStatus.ISSUED,
          amount: dto.amount,
          dueDate,
          idempotencyKey: dto.idempotencyKey,
          externalId: issued.externalId ?? null,
          externalStatus: issued.externalStatus ?? null,
          ourNumber: issued.ourNumber ?? null,
          txid: issued.txid ?? txid ?? null,
          digitableLine: issued.digitableLine ?? null,
          barcode: issued.barcode ?? null,
          pixCopyPaste: issued.pixCopyPaste ?? null,
          qrCodeUrl: issued.qrCodeUrl ?? null,
          documentUrl: issued.documentUrl ?? null,
          providerPayload: toJsonInput(issued.providerPayload),
          issuedAt: issued.issuedAt ?? new Date(),
          expiresAt: issued.expiresAt ?? expiresAt ?? null,
          attributedChannel: PaymentChargeChannel.COBCOM,
        },
      });

      // Create payment event
      await this.createPaymentEvent(charge.id, null, PaymentChargeStatus.ISSUED, PaymentEventSource.MANUAL);

      // Audit
      await this.auditService.log({
        action: 'PAYMENT_CHARGE_ISSUED',
        userId,
        resourceType: 'PaymentCharge',
        resourceId: charge.id,
        requestId,
        metadata: { method: dto.method, contractId: contract.id, gatewayId: dto.paymentGatewayId },
      });

      return charge;
    } catch (error) {
      const failedCharge = await this.handleAdapterError(error, {
        accountId,
        contractId: contract.id,
        paymentGatewayId: dto.paymentGatewayId,
        method: dto.method,
        amount: dto.amount,
        dueDate,
        idempotencyKey: dto.idempotencyKey,
        txid,
        expiresAt,
        userId,
        requestId,
      });

      throw new UnprocessableEntityException({
        message: 'Payment charge could not be issued by the payment provider',
        failureCode: failedCharge.failureCode ?? 'PROVIDER_NOT_PROCESSED',
        supportReference: failedCharge.id,
      });
    }
  }

  // ─── 5.3 — Manual Pix Issuance via CRM ────────────────────────────────────

  /**
   * Issues a Pix charge for a contract using its updatedValue.
   * Reuses existing valid Pix if available.
   * Channel = COBCOM. 24h expiration configurable.
   */
  async createPixForContract(
    contractId: string,
    accountId: string,
    userId: string,
    requestId: string,
  ) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, accountId, deletedAt: null },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    // Require updatedValue
    if (!contract.updatedValue || parseFloat(contract.updatedValue.toString()) <= 0) {
      throw new UnprocessableEntityException(
        'Contract does not have a valid updatedValue for Pix issuance',
      );
    }

    // Resolve default gateway for PIX
    const gateway = await this.resolvePixGateway(accountId);
    const existingPix = await this.findExistingValidPix(contractId, gateway.id);
    if (existingPix) {
      return existingPix;
    }
    const config = this.paymentGatewaysService.decryptCredentials(gateway);
    const adapter = this.providerFactory.getAndValidateMethod(
      gateway.providerType as any,
      PaymentMethod.PIX,
    );

    const txid = generateTxid();
    const pixExpirationHours = parseInt(process.env.PIX_EXPIRATION_HOURS ?? '', 10) || DEFAULT_PIX_EXPIRATION_HOURS;
    const expiresAt = new Date(Date.now() + pixExpirationHours * 60 * 60 * 1000);
    const idempotencyKey = randomUUID();

    const input: IssuePaymentChargeInput = {
      contractId: contract.id,
      method: PaymentMethod.PIX,
      amount: contract.updatedValue.toString(),
      dueDate: contract.dueDate ?? new Date(),
      idempotencyKey,
      txid,
      expiresAt,
      debtor: {
        name: contract.debtorName,
        document: contract.debtorDocument,
        email: contract.debtorEmail ?? undefined,
        phone: contract.debtorPhone ?? undefined,
      },
    };

    try {
      const issued = await adapter.issue(input, config);

      const charge = await this.prisma.paymentCharge.create({
        data: {
          accountId,
          contractId: contract.id,
          paymentGatewayId: gateway.id,
          method: PaymentMethod.PIX,
          status: PaymentChargeStatus.ISSUED,
          amount: contract.updatedValue.toString(),
          dueDate: contract.dueDate ?? new Date(),
          idempotencyKey,
          externalId: issued.externalId ?? null,
          externalStatus: issued.externalStatus ?? null,
          txid: issued.txid ?? txid,
          pixCopyPaste: issued.pixCopyPaste ?? null,
          qrCodeUrl: issued.qrCodeUrl ?? null,
          providerPayload: toJsonInput(issued.providerPayload),
          issuedAt: issued.issuedAt ?? new Date(),
          expiresAt: issued.expiresAt ?? expiresAt,
          attributedChannel: PaymentChargeChannel.COBCOM,
        },
      });

      await this.createPaymentEvent(charge.id, null, PaymentChargeStatus.ISSUED, PaymentEventSource.MANUAL);

      await this.auditService.log({
        action: 'PAYMENT_CHARGE_PIX_ISSUED',
        userId,
        resourceType: 'PaymentCharge',
        resourceId: charge.id,
        requestId,
        metadata: { contractId: contract.id, channel: 'COBCOM' },
      });

      return charge;
    } catch (error) {
      const failedCharge = await this.handleAdapterError(error, {
        accountId,
        contractId: contract.id,
        paymentGatewayId: gateway.id,
        method: PaymentMethod.PIX,
        amount: contract.updatedValue.toString(),
        dueDate: contract.dueDate ?? new Date(),
        idempotencyKey,
        txid,
        expiresAt,
        userId,
        requestId,
      });

      throw new UnprocessableEntityException({
        message: 'Pix could not be issued by the payment provider',
        failureCode: failedCharge.failureCode ?? 'PROVIDER_NOT_PROCESSED',
        supportReference: failedCharge.id,
      });
    }
  }

  // ─── 5.4 — Pix by Debtor Document (External Channels) ─────────────────────

  /**
   * Generates a Pix charge by debtor document for external channels.
   * Finds the single eligible contract, reuses existing valid Pix if available.
   */
  async createPixByDocument(
    dto: GeneratePixByDocumentDto,
    accountId: string,
    userId: string,
    requestId: string,
  ) {
    // Normalize document (remove punctuation)
    const normalizedDoc = dto.debtorDocument.replace(/\D/g, '');

    if (normalizedDoc.length !== 11 && normalizedDoc.length !== 14) {
      throw new BadRequestException('Invalid CPF/CNPJ format');
    }

    // Find eligible contracts
    const contracts = await this.prisma.contract.findMany({
      where: {
        accountId,
        debtorDocument: normalizedDoc,
        contractNumber: dto.contractNumber,
        status: 'ACTIVE',
        deletedAt: null,
        updatedValue: { gt: 0 },
      },
    });

    if (contracts.length === 0) {
      throw new NotFoundException('No eligible contract found for the provided document and contract number');
    }

    if (contracts.length > 1) {
      throw new ConflictException('Multiple contracts found — cannot determine unique contract');
    }

    const contract = contracts[0]!;

    // Validate eligibility
    if (!contract.updatedValue || parseFloat(contract.updatedValue.toString()) <= 0) {
      throw new UnprocessableEntityException('Contract does not have a valid updatedValue');
    }

    // Check idempotency
    const existingByKey = await this.prisma.paymentCharge.findFirst({
      where: {
        contractId: contract.id,
        idempotencyKey: dto.idempotencyKey,
        method: PaymentMethod.PIX,
      },
    });

    if (existingByKey) {
      return existingByKey;
    }

    // Issue new Pix
    const gateway = await this.resolvePixGateway(accountId);
    const existingPix = await this.findExistingValidPix(contract.id, gateway.id);
    if (existingPix) {
      return existingPix;
    }
    const config = this.paymentGatewaysService.decryptCredentials(gateway);
    const adapter = this.providerFactory.getAndValidateMethod(
      gateway.providerType as any,
      PaymentMethod.PIX,
    );

    const txid = generateTxid();
    const pixExpirationHours = parseInt(process.env.PIX_EXPIRATION_HOURS ?? '', 10) || DEFAULT_PIX_EXPIRATION_HOURS;
    const expiresAt = new Date(Date.now() + pixExpirationHours * 60 * 60 * 1000);

    const input: IssuePaymentChargeInput = {
      contractId: contract.id,
      method: PaymentMethod.PIX,
      amount: contract.updatedValue.toString(),
      dueDate: contract.dueDate ?? new Date(),
      idempotencyKey: dto.idempotencyKey,
      txid,
      expiresAt,
      debtor: {
        name: contract.debtorName,
        document: normalizedDoc,
        email: contract.debtorEmail ?? undefined,
        phone: contract.debtorPhone ?? undefined,
      },
    };

    try {
      const issued = await adapter.issue(input, config);

      const charge = await this.prisma.paymentCharge.create({
        data: {
          accountId,
          contractId: contract.id,
          paymentGatewayId: gateway.id,
          method: PaymentMethod.PIX,
          status: PaymentChargeStatus.ISSUED,
          amount: contract.updatedValue.toString(),
          dueDate: contract.dueDate ?? new Date(),
          idempotencyKey: dto.idempotencyKey,
          externalId: issued.externalId ?? null,
          externalStatus: issued.externalStatus ?? null,
          txid: issued.txid ?? txid,
          pixCopyPaste: issued.pixCopyPaste ?? null,
          qrCodeUrl: issued.qrCodeUrl ?? null,
          providerPayload: toJsonInput(issued.providerPayload),
          issuedAt: issued.issuedAt ?? new Date(),
          expiresAt: issued.expiresAt ?? expiresAt,
          attributedChannel: PaymentChargeChannel.LANDING_PAGE,
        },
      });

      await this.createPaymentEvent(charge.id, null, PaymentChargeStatus.ISSUED, PaymentEventSource.MANUAL);

      await this.auditService.log({
        action: 'PAYMENT_CHARGE_PIX_BY_DOCUMENT',
        userId,
        resourceType: 'PaymentCharge',
        resourceId: charge.id,
        requestId,
        metadata: { contractId: contract.id, channel: 'EXTERNAL' },
      });

      return charge;
    } catch (error) {
      const failedCharge = await this.handleAdapterError(error, {
        accountId,
        contractId: contract.id,
        paymentGatewayId: gateway.id,
        method: PaymentMethod.PIX,
        amount: contract.updatedValue.toString(),
        dueDate: contract.dueDate ?? new Date(),
        idempotencyKey: dto.idempotencyKey,
        txid,
        expiresAt,
        userId,
        requestId,
      });

      throw new UnprocessableEntityException({
        message: 'Pix could not be issued by the payment provider',
        failureCode: failedCharge.failureCode ?? 'PROVIDER_NOT_PROCESSED',
        supportReference: failedCharge.id,
      });
    }
  }

  // ─── 5.5 — List Charges ────────────────────────────────────────────────────

  /**
   * Lists charges for a contract, ordered by createdAt DESC.
   * Filtered by wallet access (RBAC).
   */
  async listCharges(
    contractId: string,
    accountId: string,
    userScopes?: string[],
  ) {
    // Verify contract exists and user has access
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, accountId, deletedAt: null },
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    // RBAC: check wallet access
    if (userScopes && !userScopes.includes(contract.walletId)) {
      throw new NotFoundException('Contract not found');
    }

    const charges = await this.prisma.paymentCharge.findMany({
      where: { contractId, accountId },
      orderBy: { createdAt: 'desc' },
    });

    return charges;
  }

  // ─── 5.6 — Manual Sync ────────────────────────────────────────────────────

  /**
   * Manually syncs a charge status with the provider.
   * Creates PaymentSettlement if PAID.
   */
  async syncCharge(
    chargeId: string,
    accountId: string,
    userId: string,
    requestId: string,
  ) {
    const charge = await this.prisma.paymentCharge.findFirst({
      where: { id: chargeId, accountId },
    });

    if (!charge) {
      throw new NotFoundException('Payment charge not found');
    }

    // Resolve gateway and adapter
    const gateway = await this.prisma.paymentGateway.findUnique({
      where: { id: charge.paymentGatewayId },
    });

    if (!gateway) {
      throw new NotFoundException('Payment gateway not found');
    }

    const adapter = this.providerFactory.get(gateway.providerType as any);

    if (!adapter.fetchStatus) {
      throw new UnprocessableEntityException('Provider does not support status query');
    }

    const config = this.paymentGatewaysService.decryptCredentials(gateway);

    // Build entity for adapter
    const chargeEntity = {
      ...charge,
      amount: charge.amount.toString(),
      method: charge.method as any,
      status: charge.status as any,
      attributedChannel: charge.attributedChannel as any,
      providerPayload: (charge.providerPayload as Record<string, unknown>) ?? null,
      version: charge.version,
    };

    const update = await adapter.fetchStatus(chargeEntity, config);

    const previousStatus = charge.status;

    // Update charge
    const updatedCharge = await this.prisma.paymentCharge.update({
      where: { id: chargeId },
      data: {
        status: update.status,
        externalStatus: update.externalStatus ?? charge.externalStatus,
        paidAt: update.paidAt ?? charge.paidAt,
        failureCode: update.failureCode ?? charge.failureCode,
        failureMessage: update.failureMessage ?? charge.failureMessage,
        providerPayload: toJsonInput(update.providerPayload ?? (charge.providerPayload as Record<string, unknown> | null)),
      },
    });

    // Create payment event for the transition
    if (previousStatus !== update.status) {
      await this.createPaymentEvent(
        chargeId,
        previousStatus as PaymentChargeStatus,
        update.status,
        PaymentEventSource.SYNC,
      );
    }

    // If PAID, create PaymentSettlement (best-effort, model may not exist yet)
    if (update.status === PaymentChargeStatus.PAID && previousStatus !== PaymentChargeStatus.PAID) {
      await this.createSettlement(charge, update.paidAt ?? new Date(), accountId);
    }

    // Audit
    await this.auditService.log({
      action: 'PAYMENT_CHARGE_SYNCED',
      userId,
      resourceType: 'PaymentCharge',
      resourceId: chargeId,
      requestId,
      metadata: {
        previousStatus,
        newStatus: update.status,
      },
    });

    return updatedCharge;
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Finds an existing valid Pix charge for a contract
   * (status ISSUED, expiresAt > now).
   */
  private async findExistingValidPix(contractId: string, paymentGatewayId: string) {
    return this.prisma.paymentCharge.findFirst({
      where: {
        contractId,
        paymentGatewayId,
        method: PaymentMethod.PIX,
        status: PaymentChargeStatus.ISSUED,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Resolves the active Pix-capable gateway for the account.
   */
  private async resolvePixGateway(accountId: string) {
    const environment = this.configService.getOrThrow<PaymentGatewayEnvironment>(
      'PAYMENT_GATEWAY_ENVIRONMENT',
    );

    const gateway = await this.prisma.paymentGateway.findFirst({
      where: {
        accountId,
        environment,
        enabled: true,
        supportedMethods: { has: PaymentMethod.PIX },
      },
    });

    if (!gateway) {
      throw new NotFoundException(
        `No active Pix-capable payment gateway found for ${environment}`,
      );
    }

    return gateway;
  }

  /**
   * Handles adapter errors and persists the charge with appropriate status.
   */
  private async handleAdapterError(
    error: unknown,
    params: {
      accountId: string;
      contractId: string;
      paymentGatewayId: string;
      method: PaymentMethod;
      amount: string;
      dueDate: Date;
      idempotencyKey: string;
      txid?: string;
      expiresAt?: Date;
      userId: string;
      requestId: string;
    },
  ) {
    let status: PaymentChargeStatus;
    let failureCode: string | null = null;
    let failureMessage: string | null = null;

    if (error instanceof BbTimeoutError) {
      // Timeout without response — cannot confirm failure, persist as PENDING
      status = PaymentChargeStatus.PENDING;
      failureMessage = 'Provider timeout — status unknown';
    } else if (error instanceof BbRateLimitedError) {
      status = PaymentChargeStatus.FAILED;
      failureCode = 'RATE_LIMITED';
      failureMessage = 'Provider rate limit exhausted';
    } else if (error instanceof BbProviderError) {
      status = PaymentChargeStatus.FAILED;
      failureCode = error.failureCode;
      failureMessage = error.message;
    } else {
      status = PaymentChargeStatus.FAILED;
      failureCode = 'UNKNOWN_ERROR';
      failureMessage = error instanceof Error ? error.message : 'Unknown error';
    }

    const charge = await this.prisma.paymentCharge.create({
      data: {
        accountId: params.accountId,
        contractId: params.contractId,
        paymentGatewayId: params.paymentGatewayId,
        method: params.method,
        status,
        amount: params.amount,
        dueDate: params.dueDate,
        idempotencyKey: params.idempotencyKey,
        txid: params.txid ?? null,
        expiresAt: params.expiresAt ?? null,
        failureCode,
        failureMessage,
        attributedChannel: PaymentChargeChannel.COBCOM,
      },
    });

    // Create event
    await this.createPaymentEvent(charge.id, null, status, PaymentEventSource.MANUAL);

    // Audit
    await this.auditService.log({
      action: 'PAYMENT_CHARGE_FAILED',
      userId: params.userId,
      resourceType: 'PaymentCharge',
      resourceId: charge.id,
      requestId: params.requestId,
      metadata: { failureCode, status },
    });

    return charge;
  }

  /**
   * Creates a PaymentEvent record for lifecycle tracking.
   */
  private async createPaymentEvent(
    paymentChargeId: string,
    fromStatus: PaymentChargeStatus | null,
    toStatus: PaymentChargeStatus,
    source: PaymentEventSource,
    metadata?: Record<string, unknown>,
  ) {
    try {
      await this.prisma.paymentEvent.create({
        data: {
          paymentChargeId,
          fromStatus: fromStatus ?? null,
          toStatus,
          source,
          metadata: toJsonInput(metadata) ?? undefined,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create payment event: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Creates a PaymentSettlement when a charge is confirmed PAID.
   * Best-effort: if the PaymentSettlement model doesn't exist yet in Prisma, logs and continues.
   */
  private async createSettlement(
    charge: Record<string, any>,
    paidAt: Date,
    accountId: string,
  ) {
    try {
      const prismaAny = this.prisma as any;
      if (!prismaAny.paymentSettlement) {
        this.logger.warn('PaymentSettlement model not available in Prisma — skipping settlement creation');
        return;
      }

      // Check if settlement already exists for this charge
      const existing = await prismaAny.paymentSettlement.findFirst({
        where: { paymentChargeId: charge.id },
      });

      if (existing) {
        return existing;
      }

      await prismaAny.paymentSettlement.create({
        data: {
          accountId,
          contractId: charge.contractId,
          paymentChargeId: charge.id,
          source: PaymentSettlementSource.PIX,
          status: PaymentSettlementStatus.CONFIRMED,
          amount: charge.amount.toString(),
          paidAt,
          externalPaymentId: charge.externalId ?? charge.txid ?? charge.id,
        },
      });
    } catch (error) {
      // Settlement creation is best-effort — if model doesn't exist yet, log and continue
      this.logger.warn(
        `Failed to create payment settlement for charge ${charge.id}: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
    }
  }
}
