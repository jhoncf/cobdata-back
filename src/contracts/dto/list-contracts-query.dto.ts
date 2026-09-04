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

  /** Days elapsed since the contract occurrence date. */
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

  @IsOptional()
  @IsString()
  debtorDocument?: string;

  /** Searches by contract number or CPF/CNPJ. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return [value];
    return value;
  })
  tags?: string[];
}
