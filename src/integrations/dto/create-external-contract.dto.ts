import { OmitType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { CreateContractDto } from '../../contracts/dto/create-contract.dto';

export class CreateExternalContractDto extends OmitType(CreateContractDto, ['walletId'] as const) {
  @ApiPropertyOptional({ description: 'Obrigatório apenas para chave com acesso a todos os credores.', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  creditorId?: string;
}
