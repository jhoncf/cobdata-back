import {
  IsOptional,
  IsUUID,
  IsEnum,
  IsNumber,
  IsDateString,
  IsString,
  IsBoolean,
  IsEmail,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ContractStatus, DebtType } from '@prisma/client';
import { OfferDto } from './offer.dto';

export class UpdateContractDto {
  @ApiPropertyOptional({ description: 'Original debt value in BRL', example: 1500.00, minimum: 0.01, maximum: 999999999.99 })
  @IsOptional()
  @IsNumber({}, { message: 'originalValue must be a number' })
  @Min(0.01)
  @Max(999999999.99)
  originalValue?: number;

  @ApiPropertyOptional({ description: 'Updated debt value in BRL', example: 1750.50, minimum: 0.01, maximum: 999999999.99 })
  @IsOptional()
  @IsNumber({}, { message: 'updatedValue must be a number' })
  @Min(0.01)
  @Max(999999999.99)
  updatedValue?: number;

  @ApiPropertyOptional({ description: 'Occurrence date (ISO 8601)', example: '2024-01-15' })
  @IsOptional()
  @IsDateString({}, { message: 'occurrenceDate must be a valid ISO 8601 date string' })
  occurrenceDate?: string;

  @ApiPropertyOptional({ description: 'Due date (ISO 8601)', example: '2024-02-15' })
  @IsOptional()
  @IsDateString({}, { message: 'dueDate must be a valid ISO 8601 date string' })
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Debt type', enum: ['COMMERCIAL', 'BANKING', 'SERVICES', 'UTILITIES', 'TELECOM', 'EDUCATION', 'HEALTH', 'CONDOMINIAL', 'OTHER'], example: 'BANKING' })
  @IsOptional()
  @IsEnum(DebtType, {
    message: `debtType must be one of: COMMERCIAL, BANKING, SERVICES, UTILITIES, TELECOM, EDUCATION, HEALTH, CONDOMINIAL, OTHER`,
  })
  debtType?: DebtType;

  @ApiPropertyOptional({ description: 'Wallet ID to move the contract to', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  walletId?: string;

  @ApiPropertyOptional({ description: 'Contract internal status', enum: ['ACTIVE', 'SUSPENDED', 'CANCELLED'], example: 'SUSPENDED' })
  @IsOptional()
  @IsEnum(ContractStatus, {
    message: 'status must be one of: ACTIVE, SUSPENDED, CANCELLED',
  })
  status?: ContractStatus;

  @ApiPropertyOptional({ description: 'Debt origin description (max 100 chars)', example: 'Invoice #12345' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  debtOrigin?: string;

  @ApiPropertyOptional({ description: 'Debtor name (max 200 chars)', example: 'João da Silva', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  debtorName?: string;

  @ApiPropertyOptional({ description: 'Product name (max 200 chars)', example: 'Plano Internet 100MB', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  productName?: string;

  @ApiPropertyOptional({ description: 'Debtor street address (max 300 chars)', example: 'Rua das Flores, 123', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  debtorStreet?: string;

  @ApiPropertyOptional({ description: 'Debtor city (max 100 chars)', example: 'São Paulo', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  debtorCity?: string;

  @ApiPropertyOptional({ description: 'Debtor phone number (max 20 chars)', example: '11999998888', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  debtorPhone?: string;

  @ApiPropertyOptional({ description: 'Debtor email address', example: 'devedor@email.com' })
  @IsOptional()
  @IsEmail({}, { message: 'debtorEmail must be a valid email address' })
  debtorEmail?: string;

  @ApiPropertyOptional({ description: 'Whether the debtor is negativated', default: false })
  @IsOptional()
  @IsBoolean()
  isNegativated?: boolean;

  @ApiPropertyOptional({ description: 'Date when the contract was cancelled (ISO 8601)', example: '2024-06-01' })
  @IsOptional()
  @IsDateString({}, { message: 'cancelledAt must be a valid ISO 8601 date string' })
  cancelledAt?: string;

  @ApiPropertyOptional({ description: 'Pre-calculated offer details', type: OfferDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OfferDto)
  offer?: OfferDto;
}
