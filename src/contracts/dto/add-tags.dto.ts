import { IsArray, IsString, ArrayMaxSize, MaxLength, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddTagsDto {
  @ApiProperty({ description: 'Tags to add to the contract (max 20 tags, each max 50 chars)', example: ['urgent', 'high-value'], type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags!: string[];
}
