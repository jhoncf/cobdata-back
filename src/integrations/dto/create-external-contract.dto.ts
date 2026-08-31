import { OmitType, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { DebtType } from '@prisma/client';
import { CreateContractDto } from '../../contracts/dto/create-contract.dto';

export class CreateExternalContractDto extends OmitType(CreateContractDto, ['walletId'] as const) {
  @ApiProperty({
    enum: DebtType,
    description: 'Categoria padronizada da dívida. Use OTHER quando não houver categoria adequada e detalhe o produto ou origem. Valores: COMMERCIAL (comercial), BANKING (bancária), SERVICES (serviços), UTILITIES (água, energia, gás), TELECOM (telefonia/internet), EDUCATION (educação), HEALTH (saúde), CONDOMINIAL (condomínio), OTHER (outros).',
    example: DebtType.COMMERCIAL,
  })
  @IsEnum(DebtType)
  debtType!: DebtType;

  @ApiPropertyOptional({ description: 'Obrigatório apenas para chave com acesso a todos os credores.', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  creditorId?: string;
}
