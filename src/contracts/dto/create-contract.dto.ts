import {
  IsString,
  IsUUID,
  IsEnum,
  IsNumber,
  IsOptional,
  IsDateString,
  IsBoolean,
  IsEmail,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { DebtType } from '@prisma/client';
import { IsDocument } from '../../common/validators/is-document.validator';
import { OfferDto } from './offer.dto';

export class CreateContractDto {
  @ApiProperty({ description: 'Wallet ID to associate the contract', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  walletId!: string;

  @ApiProperty({ description: 'Debtor CPF (11 digits) or CNPJ (14 digits)', example: '12345678901' })
  @IsString()
  @IsDocument({
    message: 'debtorDocument must be a valid CPF (11 digits) or CNPJ (14 digits) with valid check digits',
  })
  debtorDocument!: string;

  @ApiProperty({ description: 'Debtor name (max 200 chars)', example: 'João da Silva', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  debtorName!: string;

  @ApiProperty({ description: 'Contract number (max 100 chars)', example: 'CONTR-2024-001', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  contractNumber!: string;

  @ApiProperty({ description: 'Debt type', enum: ['COMMERCIAL', 'BANKING', 'SERVICES', 'UTILITIES', 'TELECOM', 'EDUCATION', 'HEALTH', 'CONDOMINIAL', 'OTHER'], example: 'COMMERCIAL' })
  @IsEnum(DebtType, {
    message: `debtType must be one of: COMMERCIAL, BANKING, SERVICES, UTILITIES, TELECOM, EDUCATION, HEALTH, CONDOMINIAL, OTHER`,
  })
  debtType!: DebtType;

  @ApiProperty({ description: 'Occurrence date - when the debtor acquired/contracted the service (ISO 8601)', example: '2024-01-15' })
  @IsDateString({}, { message: 'occurrenceDate must be a valid ISO 8601 date string' })
  occurrenceDate!: string;

  @ApiProperty({ description: 'Due date - when the payment was due (ISO 8601)', example: '2024-02-15' })
  @IsDateString({}, { message: 'dueDate must be a valid ISO 8601 date string' })
  dueDate!: string;

  @ApiProperty({ description: 'Original debt value in BRL (0.01 to 999,999,999.99)', example: 1500.00, minimum: 0.01, maximum: 999999999.99 })
  @IsNumber({}, { message: 'originalValue must be a number' })
  @Min(0.01)
  @Max(999999999.99)
  originalValue!: number;

  @ApiPropertyOptional({ description: 'Updated debt value in BRL (with interest, fees, etc)', example: 1750.50, minimum: 0.01, maximum: 999999999.99 })
  @IsOptional()
  @IsNumber({}, { message: 'updatedValue must be a number' })
  @Min(0.01)
  @Max(999999999.99)
  updatedValue?: number;

  @ApiPropertyOptional({ description: 'Debt origin description (max 100 chars)', example: 'Invoice #12345', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  debtOrigin?: string;

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
