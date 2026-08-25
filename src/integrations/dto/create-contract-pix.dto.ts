import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateContractPixDto {
  @ApiProperty({ description: 'CPF ou CNPJ do titular, com ou sem máscara', example: '39790216882' })
  @IsString()
  @IsNotEmpty()
  debtorDocument!: string;
}
