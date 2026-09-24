import {
  IsOptional,
  IsUUID,
  IsEnum,
  IsString,
  IsDateString,
  IsArray,
  IsNumber,
  Min,
  IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ContractStatus, SerasaStatus, PaymentStatus } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ListContractsQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  walletId?: string;

  @IsOptional()
  @IsUUID()
  creditorId?: string;

  @IsOptional()
  @IsEnum(ContractStatus)
  status?: ContractStatus;

  @IsOptional()
  @IsIn([...Object.values(SerasaStatus), 'SYNCED'])
  serasaStatus?: SerasaStatus | 'SYNCED';

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  minOriginalValue?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  maxOriginalValue?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  minUpdatedValue?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  maxUpdatedValue?: number;

  @IsOptional()
  @IsIn(['gt', 'lt', 'eq'])
  updatedValueOperator?: 'gt' | 'lt' | 'eq';

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  updatedValue?: number;

  @IsOptional()
  @IsIn(['gt', 'lt', 'eq'])
  offerValueOperator?: 'gt' | 'lt' | 'eq';

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  offerValue?: number;

  @IsOptional()
  @IsIn(['gt', 'lt', 'eq'])
  agingOperator?: 'gt' | 'lt' | 'eq';

  /** Days elapsed since the debt due date. */
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  aging?: number;

  /** Filter contracts with an agreement in more than one installment. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  installmentOnly?: boolean;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Filters by the date on which an agreement was fully paid. */
  @IsOptional()
  @IsDateString()
  paymentDateFrom?: string;

  /** Filters by the date on which an agreement was fully paid. */
  @IsOptional()
  @IsDateString()
  paymentDateTo?: string;

  /** Includes every generated agreement, regardless of payment outcome. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  agreementOnly?: boolean;

  @IsOptional()
  @IsDateString()
  agreementDateFrom?: string;

  @IsOptional()
  @IsDateString()
  agreementDateTo?: string;

  @IsOptional()
  @IsString()
  debtorDocument?: string;

  /** Searches by contract number or CPF/CNPJ. */
  @IsOptional()
  @IsString()
  search?: string;

  /** Output format used only by the filtered-contract export endpoint. */
  @IsOptional()
  @IsIn(['csv', 'xlsx'])
  format?: 'csv' | 'xlsx';

  @IsOptional()
  @IsIn(['contractNumber', 'debtorName', 'debtorDocument', 'debtType', 'originalValue', 'updatedValue', 'offerValue', 'offerDiscountPercent', 'status', 'paymentStatus', 'serasaStatus', 'occurrenceDate', 'agreementCreatedAt', 'agreementTotalAmount', 'cancelledAt', 'agingDays'])
  sortBy?: 'contractNumber' | 'debtorName' | 'debtorDocument' | 'debtType' | 'originalValue' | 'updatedValue' | 'offerValue' | 'offerDiscountPercent' | 'status' | 'paymentStatus' | 'serasaStatus' | 'occurrenceDate' | 'agreementCreatedAt' | 'agreementTotalAmount' | 'cancelledAt' | 'agingDays';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return [value];
    return value;
  })
  tags?: string[];
}
