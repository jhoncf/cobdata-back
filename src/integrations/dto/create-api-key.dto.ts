import { ApiKeyScope } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

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

  @ApiProperty({ description: 'Credor ao qual esta chave ficará restrita. Obrigatório quando accessAllCreditors for false.', format: 'uuid', required: false })
  @ValidateIf((dto: CreateApiKeyDto) => !dto.accessAllCreditors)
  @IsUUID()
  creditorId?: string;

  @ApiProperty({ description: 'Permite acesso a contratos de todos os credores da mesma conta', default: false })
  @IsOptional()
  @IsBoolean()
  accessAllCreditors?: boolean;
}
