import { IsString, IsNotEmpty, MaxLength, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWalletDto {
  @ApiProperty({ description: 'Wallet name (1-120 chars, trimmed)', example: 'Main Wallet', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name!: string;

  @ApiPropertyOptional({ description: 'Carteira Serasa vinculada (opcional)' })
  @IsOptional()
  @IsUUID()
  serasaWalletId?: string;
}
