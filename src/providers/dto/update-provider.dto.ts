import { IsEnum, IsObject, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProviderEnv } from '@prisma/client';

export class UpdateProviderDto {
  @ApiPropertyOptional({ description: 'Provider environment', enum: ['HOMOLOGATION', 'PRODUCTION'], example: 'PRODUCTION' })
  @IsEnum(ProviderEnv)
  @IsOptional()
  environment?: ProviderEnv;

  @ApiPropertyOptional({ description: 'Updated Serasa API Key (encrypted at rest)', example: { apiKey: 'new-key' } })
  @IsObject()
  @IsOptional()
  credentials?: Record<string, any>;
}
