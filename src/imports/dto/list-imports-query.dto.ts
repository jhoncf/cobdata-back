import { IsOptional, IsString, IsEnum } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ListImportsQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  walletId?: string;

  @IsOptional()
  @IsString()
  @IsEnum([
    'PENDING_VALIDATION',
    'VALIDATING',
    'VALIDATED',
    'VALIDATED_WITH_ERRORS',
    'VALIDATION_FAILED',
    'APPLYING',
    'APPLIED',
    'FAILED',
    'CANCELLED',
  ])
  status?: string;
}
