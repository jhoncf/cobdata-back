import { ApiPropertyOptional } from '@nestjs/swagger';
import { CancellationReason } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class CancelContractDto {
  @ApiPropertyOptional({ enum: CancellationReason, description: 'Motivo da baixa. No Portal do Credor, a solicitação do credor é aplicada automaticamente.' })
  @IsOptional()
  @IsEnum(CancellationReason)
  reason?: CancellationReason;
}
