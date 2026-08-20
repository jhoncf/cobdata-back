import { IsString, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class SearchQueryDto {
  @ApiProperty({
    description: 'Termo de busca (3 a 100 caracteres após trim)',
    example: 'Empresa XYZ',
    minLength: 3,
    maxLength: 100,
  })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  q!: string;
}
