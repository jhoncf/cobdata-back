import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ExternalContractQueryDto {
  @ApiPropertyOptional({ description: 'CPF ou CNPJ, com ou sem máscara', example: '39790216882' })
  @IsString()
  debtorDocument!: string;

  @ApiPropertyOptional({ description: 'Número do contrato para busca exata' })
  @IsOptional()
  @IsString()
  contractNumber?: string;
}
