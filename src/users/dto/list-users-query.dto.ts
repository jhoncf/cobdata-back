import { IsOptional, IsIn } from 'class-validator';
import { PaginationDto } from '../../common/dto';

export class ListUsersQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['PENDING', 'ACTIVE', 'INACTIVE'], {
    message: 'status must be one of: PENDING, ACTIVE, INACTIVE',
  })
  status?: 'PENDING' | 'ACTIVE' | 'INACTIVE';
}
