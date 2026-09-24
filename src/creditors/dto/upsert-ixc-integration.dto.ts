import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertIxcIntegrationDto {
  @ApiProperty({ example: 'https://ixc.exemplo.com.br', description: 'URL base do IXC Provedor' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  baseUrl!: string;

  @ApiPropertyOptional({ description: 'Token de acesso IXC no formato usuário:token. Omitir para manter o token já salvo.' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  accessToken?: string;

  @ApiPropertyOptional({ example: 60, description: 'Trazer somente títulos vencidos há pelo menos esta quantidade de dias.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  syncMinOverdueDays?: number;

  @ApiPropertyOptional({ example: 50, description: 'Trazer somente títulos a partir deste valor.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  syncMinDebtValue?: number;

  @ApiPropertyOptional({ example: 7, description: 'Executar a atualização a cada X dias.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  syncEveryDays?: number;

  @ApiPropertyOptional({ example: 7, description: 'Hora local (0 a 23) programada para atualização.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  syncAtHour?: number;

  @ApiPropertyOptional({ example: 0, description: 'Minuto local (0 a 59) programado para atualização.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(59)
  syncAtMinute?: number;
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
