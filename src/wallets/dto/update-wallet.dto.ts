import { IsString, IsNotEmpty, MaxLength, IsOptional, IsIn, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateWalletDto {
  @ApiPropertyOptional({ description: 'Wallet name (1-120 chars, trimmed)', example: 'Updated Wallet Name', maxLength: 120 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name?: string;

  @ApiPropertyOptional({ description: 'Wallet status', enum: ['ACTIVE', 'INACTIVE'], example: 'ACTIVE' })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ nullable: true, description: 'Carteira Serasa vinculada; envie null para desvincular' })
  @IsOptional()
  @IsUUID()
  serasaWalletId?: string | null;
}
