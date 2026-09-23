import { IsEnum, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { WalletStatus } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ListWalletsQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  creditorId?: string;

  @IsOptional()
  @IsEnum(WalletStatus)
  status?: WalletStatus;

  @IsOptional()
  @IsIn(['name', 'createdAt', 'status'])
  sortBy?: 'name' | 'createdAt' | 'status';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}
