import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, ValidateIf } from 'class-validator';

export class UpdateContractContactsDto {
  @ApiPropertyOptional({ example: '11999999999' })
  @IsOptional()
  @IsString()
  @ValidateIf((dto) => !dto.email)
  phone?: string;

  @ApiPropertyOptional({ example: 'cliente@email.com' })
  @IsOptional()
  @IsEmail()
  @ValidateIf((dto) => !dto.phone)
  email?: string;
}
