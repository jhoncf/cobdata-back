import { IsEnum, IsNotEmpty, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ProviderType, ProviderEnv } from '@prisma/client';

export class CreateProviderDto {
  @ApiProperty({ description: 'Provider type', enum: ['SERASA_LNOP'], example: 'SERASA_LNOP' })
  @IsEnum(ProviderType)
  @IsNotEmpty()
  type!: ProviderType;

  @ApiProperty({ description: 'Provider environment', enum: ['HOMOLOGATION', 'PRODUCTION'], example: 'HOMOLOGATION' })
  @IsEnum(ProviderEnv)
  @IsNotEmpty()
  environment!: ProviderEnv;

  @ApiProperty({ description: 'Provider credentials (encrypted at rest)', example: { apiKey: 'xxx', baseUrl: 'https://api.serasa.com' } })
  @IsObject()
  @IsNotEmpty()
  credentials!: Record<string, any>;
}
