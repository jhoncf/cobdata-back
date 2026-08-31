import { ApiProperty } from '@nestjs/swagger';
import { ApiKeyScope } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsEnum } from 'class-validator';

export class UpdateApiKeyScopesDto {
  @ApiProperty({ enum: ApiKeyScope, isArray: true, example: [ApiKeyScope.CONTRACTS_READ, ApiKeyScope.PIX_CREATE] })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(ApiKeyScope, { each: true })
  scopes!: ApiKeyScope[];
}
