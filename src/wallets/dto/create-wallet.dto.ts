import { IsString, IsNotEmpty, MaxLength, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWalletDto {
  @ApiProperty({ description: 'Wallet name (1-120 chars, trimmed)', example: 'Main Wallet', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name!: string;

  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0) @Max(100)
  cobcomDiscountPercent?: number;

  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(1) @Max(365)
  offerFirstInstallmentDays?: number;

  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0.01) @Max(999999999.99)
  offerMinInstallmentValue?: number;

  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(1) @Max(999)
  offerMaxInstallments?: number;
}
