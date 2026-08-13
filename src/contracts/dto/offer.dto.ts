import { IsOptional, IsNumber, IsEnum, IsString, Min, Max, IsInt } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum OfferType {
  DISCOUNT = 'DISCOUNT',
  INSTALLMENT = 'INSTALLMENT',
  FULL_PAYMENT = 'FULL_PAYMENT',
}

export class OfferDto {
  @ApiPropertyOptional({ description: 'Type of offer', enum: OfferType })
  @IsOptional()
  @IsEnum(OfferType)
  type?: OfferType;

  @ApiPropertyOptional({ description: 'Discount percentage (0-100)', example: 30 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercentage?: number;

  @ApiPropertyOptional({ description: 'Number of installments', example: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(360)
  installments?: number;

  @ApiPropertyOptional({ description: 'Installment value in BRL', example: 150.50 })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  installmentValue?: number;

  @ApiPropertyOptional({ description: 'Total offer value in BRL', example: 1806.00 })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  totalValue?: number;

  @ApiPropertyOptional({ description: 'Offer expiration date (ISO 8601)', example: '2025-03-15' })
  @IsOptional()
  @IsString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Additional notes or conditions' })
  @IsOptional()
  @IsString()
  notes?: string;
}
