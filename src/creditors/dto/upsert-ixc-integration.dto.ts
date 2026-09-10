import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertIxcIntegrationDto {
  @ApiProperty({ example: 'https://ixc.exemplo.com.br', description: 'URL base do IXC Provedor' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  baseUrl!: string;

  @ApiProperty({ description: 'Token de acesso IXC no formato usuário:token' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  accessToken!: string;
}

export class TestIxcIntegrationDto {
  @ApiProperty({ example: 'https://ixc.exemplo.com.br', description: 'URL base do IXC Provedor' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  baseUrl!: string;

  @ApiPropertyOptional({
    description: 'Token no formato usuário:token. Omitir para testar o token já salvo.',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  accessToken?: string;
}
