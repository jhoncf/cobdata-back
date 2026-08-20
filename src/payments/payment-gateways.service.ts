import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../providers/crypto.service';
import { CreatePaymentGatewayDto } from './dto/create-payment-gateway.dto';
import { UpdatePaymentGatewayDto } from './dto/update-payment-gateway.dto';
import { PaymentGatewayResponseDto } from './dto/payment-gateway-response.dto';
import {
  PaymentProviderType,
  PaymentMethod,
  PaymentGatewayEnvironment,
} from './enums';
import { DecryptedGatewayConfig } from './adapters/types';

/**
 * Maps a Prisma PaymentGateway record to the shape expected by PaymentGatewayResponseDto.fromEntity.
 * Handles enum casting between Prisma string literals and our domain enums.
 */
function toEntityShape(record: {
  id: string;
  accountId: string;
  name: string;
  providerType: string;
  environment: string;
  enabled: boolean;
  supportedMethods: string[];
  pixKey: string | null;
  encryptedCredentials: string;
  timeoutMs: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    accountId: record.accountId,
    name: record.name,
    providerType: record.providerType as PaymentProviderType,
    environment: record.environment as PaymentGatewayEnvironment,
    enabled: record.enabled,
    supportedMethods: record.supportedMethods as PaymentMethod[],
    pixKey: record.pixKey,
    encryptedCredentials: record.encryptedCredentials,
    timeoutMs: record.timeoutMs,
    maxRetries: record.maxRetries,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

@Injectable()
export class PaymentGatewaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
  ) {}

  /**
   * Creates a new payment gateway configuration.
   * Credentials are encrypted before persistence and never returned.
   */
  async create(
    accountId: string,
    dto: CreatePaymentGatewayDto,
  ): Promise<PaymentGatewayResponseDto> {
    const { credentials, ...gatewayData } = dto;

    // Extract pixKey from credentials and encrypt separately if present
    const { pixKey, ...credentialFields } = credentials;
    const encryptedPixKey = pixKey
      ? this.cryptoService.encrypt(pixKey)
      : null;

    const encryptedCredentials = this.cryptoService.encrypt(
      JSON.stringify(credentialFields),
    );

    const gateway = await this.prisma.paymentGateway.create({
      data: {
        accountId,
        name: gatewayData.name,
        providerType: gatewayData.providerType,
        environment: gatewayData.environment,
        enabled: gatewayData.enabled ?? false,
        supportedMethods: gatewayData.supportedMethods,
        pixKey: encryptedPixKey,
        encryptedCredentials,
      },
    });

    return PaymentGatewayResponseDto.fromEntity({
      ...toEntityShape(gateway),
      _decryptedCredentials: { certificateBase64: credentialFields.certificateBase64 },
    });
  }

  /**
   * Lists all payment gateways for an account.
   * Never returns credentials.
   */
  async findAll(accountId: string): Promise<PaymentGatewayResponseDto[]> {
    const gateways = await this.prisma.paymentGateway.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
    });

    return gateways.map((gw) => PaymentGatewayResponseDto.fromEntity(toEntityShape(gw)));
  }

  /**
   * Finds a single payment gateway by id for the given account.
   * Never returns credentials.
   */
  async findOne(
    id: string,
    accountId: string,
  ): Promise<PaymentGatewayResponseDto> {
    const gateway = await this.prisma.paymentGateway.findFirst({
      where: { id, accountId },
    });

    if (!gateway) {
      throw new NotFoundException('Payment gateway not found');
    }

    return PaymentGatewayResponseDto.fromEntity(toEntityShape(gateway));
  }

  /**
   * Updates a payment gateway configuration.
   * If credentials are provided, re-encrypts and replaces.
   * If not provided, existing credentials remain unchanged.
   * Never returns credentials.
   */
  async update(
    id: string,
    accountId: string,
    dto: UpdatePaymentGatewayDto,
  ): Promise<PaymentGatewayResponseDto> {
    const existing = await this.prisma.paymentGateway.findFirst({
      where: { id, accountId },
    });

    if (!existing) {
      throw new NotFoundException('Payment gateway not found');
    }

    const data: Record<string, unknown> = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.providerType !== undefined) {
      data.providerType = dto.providerType;
    }
    if (dto.environment !== undefined) {
      data.environment = dto.environment;
    }
    if (dto.enabled !== undefined) {
      data.enabled = dto.enabled;
    }
    if (dto.supportedMethods !== undefined) {
      data.supportedMethods = dto.supportedMethods;
    }

    let certificateBase64: string | undefined;

    if (dto.credentials !== undefined) {
      const { pixKey, ...credentialFields } = dto.credentials;

      // Re-encrypt credentials
      data.encryptedCredentials = this.cryptoService.encrypt(
        JSON.stringify(credentialFields),
      );

      // Update pixKey if provided in credentials
      if (pixKey !== undefined) {
        data.pixKey = pixKey ? this.cryptoService.encrypt(pixKey) : null;
      }

      certificateBase64 = credentialFields.certificateBase64;
    }

    const updated = await this.prisma.paymentGateway.update({
      where: { id },
      data,
    });

    return PaymentGatewayResponseDto.fromEntity({
      ...toEntityShape(updated),
      _decryptedCredentials: certificateBase64 !== undefined
        ? { certificateBase64 }
        : undefined,
    });
  }

  /**
   * Resolves the default (single active) gateway for a given account,
   * provider type and environment combination.
   * Throws NotFoundException if no matching active gateway is found.
   */
  async resolveDefault(
    accountId: string,
    providerType: PaymentProviderType,
    environment: PaymentGatewayEnvironment,
  ) {
    const gateway = await this.prisma.paymentGateway.findFirst({
      where: {
        accountId,
        providerType,
        environment,
        enabled: true,
      },
    });

    if (!gateway) {
      throw new NotFoundException(
        `No active payment gateway found for provider ${providerType} in ${environment} environment`,
      );
    }

    return gateway;
  }

  /**
   * Decrypts gateway credentials for internal adapter use only.
   * Accepts a gateway entity directly without additional DB lookup.
   * MUST NOT be exposed via controllers or included in any API response.
   */
  decryptCredentials(gateway: {
    encryptedCredentials: string;
    pixKey: string | null;
    environment: string;
    timeoutMs: number;
    maxRetries: number;
  }): DecryptedGatewayConfig {
    const credentials = JSON.parse(
      this.cryptoService.decrypt(gateway.encryptedCredentials),
    );

    const pixKey = gateway.pixKey
      ? this.cryptoService.decrypt(gateway.pixKey)
      : undefined;

    return {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      developerKey: credentials.developerKey,
      certificateBase64: credentials.certificateBase64,
      certificatePassword: credentials.certificatePassword,
      pixKey,
      environment: gateway.environment as PaymentGatewayEnvironment,
      timeoutMs: gateway.timeoutMs,
      maxRetries: gateway.maxRetries,
    };
  }

  /**
   * Decrypts gateway credentials by gateway ID.
   * Fetches the gateway from the database, then decrypts.
   * MUST NOT be exposed via controllers or included in any API response.
   */
  async getDecryptedConfig(gatewayId: string): Promise<DecryptedGatewayConfig> {
    const gateway = await this.prisma.paymentGateway.findUnique({
      where: { id: gatewayId },
    });

    if (!gateway) {
      throw new NotFoundException('Payment gateway not found');
    }

    return this.decryptCredentials(gateway);
  }
}
