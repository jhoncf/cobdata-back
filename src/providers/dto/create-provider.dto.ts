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

  @ApiProperty({ description: 'Serasa API Key (encrypted at rest). The API base URL is selected from the environment.', example: { apiKey: 'xxx' } })
  @IsObject()
  @IsNotEmpty()
  credentials!: Record<string, any>;
}
