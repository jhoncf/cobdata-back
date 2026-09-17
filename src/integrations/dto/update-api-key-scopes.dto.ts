import { ApiProperty } from '@nestjs/swagger';
import { ApiKeyScope } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class UpdateApiKeyScopesDto {
  @ApiProperty({ enum: ApiKeyScope, isArray: true, example: [ApiKeyScope.CONTRACTS_READ, ApiKeyScope.PIX_CREATE] })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(ApiKeyScope, { each: true })
  scopes!: ApiKeyScope[];

  @ApiProperty({ required: false, description: 'Libera a chave para todos os credores da conta.' })
  @IsOptional()
  @IsBoolean()
  accessAllCreditors?: boolean;

  @ApiProperty({ required: false, format: 'uuid', description: 'Credor autorizado quando a chave não é global.' })
  @ValidateIf((dto: UpdateApiKeyScopesDto) => dto.accessAllCreditors === false)
  @IsUUID()
  creditorId?: string;
}
