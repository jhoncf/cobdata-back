import { IsString, IsNotEmpty, IsOptional, IsBase64 } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsValidCertificate } from '../../common/validators/is-valid-certificate.validator';

/**
 * Nested DTO for Payment Gateway credentials.
 * These values are encrypted at rest and never exposed in API responses.
 */
export class GatewayCredentialsDto {
  @ApiProperty({ description: 'OAuth client ID for the payment provider' })
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @ApiProperty({ description: 'OAuth client secret for the payment provider' })
  @IsString()
  @IsNotEmpty()
  clientSecret!: string;

  @ApiProperty({ description: 'Developer application key for the payment provider' })
  @IsString()
  @IsNotEmpty()
  developerKey!: string;

  @ApiPropertyOptional({
    description: 'Base64-encoded PFX/P12 certificate for mTLS authentication. Must not be expired.',
  })
  @IsOptional()
  @IsString()
  @IsBase64()
  @IsValidCertificate({
    message: 'Certificate is invalid, could not be parsed, or is expired. Provide a valid, non-expired PFX/P12 certificate in base64 format.',
  })
  certificateBase64?: string;

  @ApiPropertyOptional({
    description: 'Password for the PFX/P12 certificate',
  })
  @IsOptional()
  @IsString()
  certificatePassword?: string;

  @ApiPropertyOptional({
    description: 'Pix receiver key (CPF, CNPJ, email, phone or EVP)',
  })
  @IsOptional()
  @IsString()
  pixKey?: string;
}
