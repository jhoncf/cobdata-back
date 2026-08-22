import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class UpsertLigueLeadAgentDto {
  @IsString() @Length(1, 100) name!: string;
  @IsString() @Length(1, 35000) prompt!: string;
  @IsOptional() @IsString() @Length(1, 600) greetings?: string;
  @IsIn(['lumen-mini', 'lumen-1', 'prisma-1']) modelVersion: 'lumen-mini' | 'lumen-1' | 'prisma-1' = 'lumen-1';
  @IsString() @Length(1, 100) voiceId!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class DispatchBaseDto {
  @IsString() @Length(1, 200) title!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @IsUUID('4', { each: true }) contractIds!: string[];
}

export class SendLigueLeadSmsDto extends DispatchBaseDto {
  @IsString() @Length(1, 1600) message!: string;
}

export class SendLigueLeadCallsDto extends DispatchBaseDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3) retryAttempts?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(180) retryIntervalMin?: number;
}
