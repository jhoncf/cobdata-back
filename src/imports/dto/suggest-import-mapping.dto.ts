import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsObject, IsString, ArrayMaxSize } from 'class-validator';

/** Metadata only: actual spreadsheet values are never sent to Bedrock. */
export class SuggestImportMappingDto {
  @ApiProperty({ example: ['CPF', 'NUM_ADM', 'Valor em Aberto'] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  headers!: string[];

  @ApiProperty({ example: { CPF: '[CPF com 11 dígitos]', 'Valor em Aberto': '[valor monetário]' } })
  @IsObject()
  sampleFormats!: Record<string, string>;
}
