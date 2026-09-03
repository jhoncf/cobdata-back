import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsNumber, IsOptional, Max, Min, ValidateNested } from 'class-validator';

export class DiscountBandDto {
  @Type(() => Number) @IsInt() @Min(0) minAgingDays!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxAgingDays?: number | null;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) cashDiscountPercent!: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) installmentDiscountPercent!: number;
}

export class UpsertCommercialRulesDto {
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => DiscountBandDto)
  discountBands!: DiscountBandDto[];

  @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  commissionPercent!: number;
}
