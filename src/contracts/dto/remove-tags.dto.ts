import { IsArray, IsString, ArrayMinSize, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RemoveTagsDto {
  @ApiProperty({ description: 'Tags to remove from the contract', example: ['old-tag'], type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags!: string[];
}
