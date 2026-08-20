import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsArray,
  ArrayMinSize,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PaymentProviderType,
  PaymentMethod,
  PaymentGatewayEnvironment,
} from '../enums';
import { GatewayCredentialsDto } from './gateway-credentials.dto';

/**
 * DTO for creating a Payment Gateway configuration.
 * Credentials are encrypted at rest upon storage.
 */
export class CreatePaymentGatewayDto {
  @ApiProperty({
    description: 'Gateway display name',
    example: 'Banco do Brasil - Produção',
    minLength: 3,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  name!: string;

  @ApiProperty({
    description: 'Payment provider type',
    enum: PaymentProviderType,
    example: PaymentProviderType.BANCO_DO_BRASIL,
  })
  @IsEnum(PaymentProviderType)
  @IsNotEmpty()
  providerType!: PaymentProviderType;

  @ApiProperty({
    description: 'Gateway environment (sandbox or production)',
    enum: PaymentGatewayEnvironment,
    example: PaymentGatewayEnvironment.SANDBOX,
  })
  @IsEnum(PaymentGatewayEnvironment)
  @IsNotEmpty()
  environment!: PaymentGatewayEnvironment;

  @ApiPropertyOptional({
    description: 'Whether the gateway is active for charge issuance',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({
    description: 'Supported payment methods for this gateway',
    enum: PaymentMethod,
    isArray: true,
    example: [PaymentMethod.PIX, PaymentMethod.BOLETO],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(PaymentMethod, { each: true })
  supportedMethods!: PaymentMethod[];

  @ApiProperty({
    description: 'Provider credentials (encrypted at rest, never returned in responses)',
    type: GatewayCredentialsDto,
  })
  @ValidateNested()
  @Type(() => GatewayCredentialsDto)
  @IsNotEmpty()
  credentials!: GatewayCredentialsDto;
}
