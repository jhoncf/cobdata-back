import { ApiProperty } from '@nestjs/swagger';
import {
  PaymentProviderType,
  PaymentMethod,
  PaymentGatewayEnvironment,
} from '../enums';

/**
 * Response DTO for Payment Gateway.
 * NEVER includes credentials, tokens, certificates or secrets.
 * Exposes only boolean indicators for credential presence.
 */
export class PaymentGatewayResponseDto {
  @ApiProperty({ description: 'Gateway unique identifier' })
  id!: string;

  @ApiProperty({ description: 'Account identifier that owns this gateway' })
  accountId!: string;

  @ApiProperty({ description: 'Gateway display name' })
  name!: string;

  @ApiProperty({ description: 'Payment provider type', enum: PaymentProviderType })
  providerType!: PaymentProviderType;

  @ApiProperty({ description: 'Gateway environment', enum: PaymentGatewayEnvironment })
  environment!: PaymentGatewayEnvironment;

  @ApiProperty({ description: 'Whether the gateway is active' })
  enabled!: boolean;

  @ApiProperty({
    description: 'Supported payment methods',
    enum: PaymentMethod,
    isArray: true,
  })
  supportedMethods!: PaymentMethod[];

  @ApiProperty({ description: 'HTTP timeout in milliseconds for provider calls' })
  timeoutMs!: number;

  @ApiProperty({ description: 'Maximum retry attempts for transient failures' })
  maxRetries!: number;

  @ApiProperty({ description: 'Whether credentials are configured (clientId, clientSecret, developerKey)' })
  hasCredentials!: boolean;

  @ApiProperty({ description: 'Whether a Pix receiver key is configured' })
  hasPixKey!: boolean;

  @ApiProperty({ description: 'Whether an mTLS certificate is configured' })
  hasCertificate!: boolean;

  @ApiProperty({ description: 'Gateway creation timestamp' })
  createdAt!: Date;

  @ApiProperty({ description: 'Gateway last update timestamp' })
  updatedAt!: Date;

  /**
   * Maps a PaymentGateway entity to the response DTO.
   * Ensures credentials are never exposed — only boolean indicators.
   */
  static fromEntity(entity: {
    id: string;
    accountId: string;
    name: string;
    providerType: PaymentProviderType;
    environment: PaymentGatewayEnvironment;
    enabled: boolean;
    supportedMethods: PaymentMethod[];
    pixKey: string | null;
    encryptedCredentials: string;
    timeoutMs: number;
    maxRetries: number;
    createdAt: Date;
    updatedAt: Date;
    /** Optional: decrypted credentials object for checking certificate presence */
    _decryptedCredentials?: { certificateBase64?: string } | null;
  }): PaymentGatewayResponseDto {
    const dto = new PaymentGatewayResponseDto();
    dto.id = entity.id;
    dto.accountId = entity.accountId;
    dto.name = entity.name;
    dto.providerType = entity.providerType;
    dto.environment = entity.environment;
    dto.enabled = entity.enabled;
    dto.supportedMethods = entity.supportedMethods;
    dto.timeoutMs = entity.timeoutMs;
    dto.maxRetries = entity.maxRetries;
    dto.hasCredentials = !!entity.encryptedCredentials;
    dto.hasPixKey = !!entity.pixKey;
    dto.hasCertificate = !!(entity._decryptedCredentials?.certificateBase64);
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
