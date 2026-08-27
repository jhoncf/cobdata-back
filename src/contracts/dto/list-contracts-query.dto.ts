import {
  IsOptional,
  IsUUID,
  IsEnum,
  IsString,
  IsDateString,
  IsArray,
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
  @IsEnum(SerasaStatus)
  serasaStatus?: SerasaStatus;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return [value];
    return value;
  })
  tags?: string[];
}
