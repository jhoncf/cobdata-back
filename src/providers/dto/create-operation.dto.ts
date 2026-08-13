import { IsEnum, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OperationAction } from '@prisma/client';

export class CreateOperationDto {
  @ApiProperty({ description: 'Wallet ID to create the operation for', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  walletId!: string;

  @ApiProperty({ description: 'Operation action type', enum: ['CREATE_OR_UPDATE', 'REMOVE'], example: 'CREATE_OR_UPDATE' })
  @IsEnum(OperationAction)
  action!: OperationAction;
}
