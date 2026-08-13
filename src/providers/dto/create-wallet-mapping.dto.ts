import { IsString, IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWalletMappingDto {
  @ApiProperty({ description: 'Local wallet ID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  @IsNotEmpty()
  walletId!: string;

  @ApiProperty({ description: 'External wallet ID from the provider', example: 'EXT-WALLET-123' })
  @IsString()
  @IsNotEmpty()
  externalWalletId!: string;
}
