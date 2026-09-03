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

  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => WalletDiscountBandDto)
  discountBands?: WalletDiscountBandDto[];
}

export class WalletDiscountBandDto {
  @Type(() => Number) @IsInt() @Min(0) minAgingDays!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxAgingDays?: number | null;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) cashDiscountPercent!: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) installmentDiscountPercent!: number;
}
