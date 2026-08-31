import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus, SerasaStatus } from '@prisma/client';

export class BulkTransferContractFiltersDto {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({ enum: SerasaStatus })
  @IsOptional()
  @IsEnum(SerasaStatus)
  serasaStatus?: SerasaStatus;

  @ApiPropertyOptional({ description: 'Somente contratos parcelados' })
  @IsOptional()
  @IsBoolean()
  installmentOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minOriginalValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxOriginalValue?: number;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minUpdatedValue?: number;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxUpdatedValue?: number;
}

export class BulkTransferContractsDto {
  @ApiProperty({ description: 'Carteira de origem', format: 'uuid' })
  @IsUUID()
  sourceWalletId!: string;

  @ApiProperty({ description: 'Carteira de destino', format: 'uuid' })
  @IsUUID()
  destinationWalletId!: string;

  @ApiPropertyOptional({ type: BulkTransferContractFiltersDto })
  @IsOptional()
  filters?: BulkTransferContractFiltersDto;
}
