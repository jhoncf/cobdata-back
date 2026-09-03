import { IsEmail, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InviteCreditorUserDto {
  @ApiProperty({ example: 'financeiro@credor.com.br' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: 'Maria da Silva' })
  @IsOptional()
  @IsString()
  name?: string;
}
