import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { OperationStatus } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ListOperationsDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  walletId?: string;

  @IsOptional()
  @IsEnum(OperationStatus)
  status?: OperationStatus;
}
