import { IsUUID, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OperationAction } from '@prisma/client';

export class PreviewOperationDto {
  @ApiProperty({ description: 'Wallet ID to preview eligible contracts', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  walletId!: string;

  @ApiProperty({ description: 'Operation action type', enum: ['CREATE_OR_UPDATE', 'REMOVE'], example: 'CREATE_OR_UPDATE' })
  @IsEnum(OperationAction, {
    message: 'action must be one of: CREATE_OR_UPDATE, REMOVE',
  })
  action!: OperationAction;
}
