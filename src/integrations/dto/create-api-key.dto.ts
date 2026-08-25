import { ApiKeyScope } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsEnum, IsString, MaxLength } from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Automação de cobrança - parceiro X' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: ApiKeyScope, isArray: true, example: [ApiKeyScope.CONTRACTS_READ, ApiKeyScope.PIX_CREATE] })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(ApiKeyScope, { each: true })
  scopes!: ApiKeyScope[];
}
