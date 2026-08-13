import { IsNotEmpty, IsUUID, IsObject } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class UploadImportDto {
  @ApiProperty({ description: 'Wallet ID to associate the import batch', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  @IsNotEmpty()
  walletId!: string;

  @ApiProperty({ description: 'Column mapping from CSV/XLSX columns to contract fields', example: { col_a: 'debtorDocument', col_b: 'contractNumber' } })
  @IsObject()
  @IsNotEmpty()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  })
  columnMapping!: Record<string, string>;
}
