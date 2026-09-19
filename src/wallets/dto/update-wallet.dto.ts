import { IsString, IsNotEmpty, MaxLength, IsOptional, IsIn, IsNumber, Min, Max, IsArray, ArrayMaxSize, ValidateNested, IsInt } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateWalletDto {
  @ApiPropertyOptional({ description: 'Wallet name (1-120 chars, trimmed)', example: 'Updated Wallet Name', maxLength: 120 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name?: string;

  @ApiPropertyOptional({ description: 'Target wallet ID in Serasa. Leave empty to use the Serasa PRE_CALCULADA default wallet.', example: 'wallet-serasa-123', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  serasaWalletExternalId?: string;

  @ApiPropertyOptional({ description: 'Wallet status', enum: ['ACTIVE', 'INACTIVE'], example: 'ACTIVE' })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0) @Max(100)
  cobcomDiscountPercent?: number;

  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(1) @Max(365)
  offerFirstInstallmentDays?: number;

  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0.01) @Max(999999999.99)
  offerMinInstallmentValue?: number;

  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(1) @Max(999)
  offerMaxInstallments?: number;

  @ApiPropertyOptional({ description: 'Debt type applied when an imported file does not provide one.', enum: ['COMMERCIAL', 'BANKING', 'SERVICES', 'UTILITIES', 'TELECOM', 'EDUCATION', 'HEALTH', 'CONDOMINIAL', 'OTHER'] })
  @IsOptional()
  @IsIn(['COMMERCIAL', 'BANKING', 'SERVICES', 'UTILITIES', 'TELECOM', 'EDUCATION', 'HEALTH', 'CONDOMINIAL', 'OTHER'])
  defaultDebtType?: string;

  @IsOptional() @IsString() @MaxLength(1400)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  smsTemplate?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => WalletDiscountBandDto)
  discountBands?: WalletDiscountBandDto[];
}

export class WalletDiscountBandDto {
  @Type(() => Number) @IsInt() @Min(0) minAgingDays!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxAgingDays?: number | null;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) cashDiscountPercent!: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) installmentDiscountPercent!: number;
}
