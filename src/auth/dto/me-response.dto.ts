import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiPropertyOptional({ description: 'User display name', nullable: true })
  name!: string | null;

  @ApiProperty()
  role!: string;

  @ApiPropertyOptional({ description: 'Creditor assigned to a restricted portal user', nullable: true })
  creditorId?: string | null;

  @ApiProperty({ description: 'Wallet IDs for VIEWER, empty for others' })
  scopes!: string[]; // walletIds for VIEWER, empty for others
}
