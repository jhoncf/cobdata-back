import {
  IsString,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsArray,
  ArrayMinSize,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  PaymentProviderType,
  PaymentMethod,
  PaymentGatewayEnvironment,
} from '../enums';
import { GatewayCredentialsDto } from './gateway-credentials.dto';

/**
 * DTO for updating a Payment Gateway configuration.
 * All fields are optional — only provided fields are updated.
 * Follows PartialType pattern from @nestjs/swagger.
 */
export class UpdatePaymentGatewayDto {
  @ApiPropertyOptional({
    description: 'Gateway display name',
    example: 'Banco do Brasil - Homologação',
    minLength: 3,
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  name?: string;

  @ApiPropertyOptional({
    description: 'Payment provider type',
    enum: PaymentProviderType,
    example: PaymentProviderType.BANCO_DO_BRASIL,
  })
  @IsOptional()
  @IsEnum(PaymentProviderType)
  providerType?: PaymentProviderType;

  @ApiPropertyOptional({
    description: 'Gateway environment (sandbox or production)',
    enum: PaymentGatewayEnvironment,
    example: PaymentGatewayEnvironment.PRODUCTION,
  })
  @IsOptional()
  @IsEnum(PaymentGatewayEnvironment)
  environment?: PaymentGatewayEnvironment;

  @ApiPropertyOptional({
    description: 'Whether the gateway is active for charge issuance',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Supported payment methods for this gateway',
    enum: PaymentMethod,
    isArray: true,
    example: [PaymentMethod.PIX],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(PaymentMethod, { each: true })
  supportedMethods?: PaymentMethod[];

  @ApiPropertyOptional({
    description: 'Provider credentials (encrypted at rest, never returned in responses)',
    type: GatewayCredentialsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => GatewayCredentialsDto)
  credentials?: GatewayCredentialsDto;
}
